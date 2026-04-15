"""MM 봇 메인 루프 — 호가 갱신, 오더북 반영, 온체인 예치·취소."""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from decimal import Decimal
from typing import TYPE_CHECKING

from src.matching.runner import run_matching_cycle
from src.mm_bot.escrow_client import MMEscrowClient, decimal_to_wei
from src.mm_bot.inventory import InventoryState
from src.mm_bot.order_gen import bid_ask_prices
from src.mm_bot.price_feed import BinanceWsFeed, PriceFeedListener, wall_time
from src.mm_bot.risk import RiskConfig, RiskController
from src.mm_bot.spread import SpreadCalculator, SpreadConfig
from src.models.order import Order
from src.models.orderbook import OrderBook
from src.ws import ConnectionManager

if TYPE_CHECKING:
    from src.mm_bot.config import MMSettings

logger = logging.getLogger(__name__)


def _env_token_decimals() -> int:
    try:
        return int(os.environ.get("MM_TOKEN_DECIMALS", "18"))
    except ValueError:
        return 18


class MMBot:
    """스펙 v2 Lean: 테스트넷에서 양방향 호가를 유지하고 체결 시 재고를 갱신한다."""

    def __init__(
        self,
        *,
        settings: MMSettings,
        orderbook: OrderBook,
        ws_manager: ConnectionManager,
    ) -> None:
        self._cfg = settings
        self._orderbook = orderbook
        self._ws = ws_manager
        self._running = False

        pr = settings.pricing
        sources = pr.get("sources") or []
        if len(sources) >= 2 and isinstance(sources[0], dict) and isinstance(sources[1], dict):
            w0 = float(sources[0].get("weight", 0.6))
            w1 = float(sources[1].get("weight", 0.4))
            tot = w0 + w1
            pw, bw = (w0 / tot, w1 / tot) if tot > 0 else (0.6, 0.4)
        elif len(sources) == 1 and isinstance(sources[0], dict):
            name = sources[0].get("name", "")
            if "binance" in name:
                pw, bw = 0.0, 1.0
            else:
                pw, bw = 1.0, 0.0
        else:
            pw, bw = 0.6, 0.4
        self._binance_ws = BinanceWsFeed()
        self._price_feed = PriceFeedListener(
            pancake_weight=pw,
            binance_weight=bw,
            outlier_threshold_pct=float(pr.get("outlier_threshold_pct", 2.0)),
            binance_ws=self._binance_ws,
        )

        sp = settings.spread
        self._spread_cfg = SpreadConfig(
            base_bps=float(sp.get("base_bps", 30)),
            min_bps=float(sp.get("min_bps", 10)),
            max_bps=float(sp.get("max_bps", 200)),
            vol_window_sec=float(sp.get("vol_window_sec", 60)),
            vol_multiplier_max=float(sp.get("vol_multiplier_max", 3.0)),
        )

        rk = settings.risk
        self._risk_cfg = RiskConfig(
            max_exposure_pct=float(rk.get("max_exposure_pct", 70)),
            rebalance_threshold_pct=float(rk.get("rebalance_threshold_pct", 60)),
            price_shock_pct=float(rk.get("price_shock_pct", 5.0)),
            price_shock_window_sec=float(rk.get("price_shock_window_sec", 60)),
            min_inventory_pct=float(rk.get("min_inventory_pct", 5.0)),
        )

        od = settings.order
        self._refresh_sec = float(od.get("refresh_interval_sec", 5))
        self._default_size = Decimal(str(od.get("default_size_base", 100)))
        self._refresh_threshold_pct = float(od.get("price_refresh_threshold_pct", 0.05))

        oc = settings.onchain
        self._base_token = oc.base_token if oc else ""
        self._quote_token = oc.quote_token if oc else ""
        self._gas_gwei = oc.gas_price_gwei if oc else 10

        pk = os.environ.get("MM_BOT_PRIVATE_KEY", "").strip()
        self._escrow = MMEscrowClient(private_key=pk or None, gas_price_gwei=self._gas_gwei)

        self._wallet = self._escrow.address or ""
        self._wallet_lower = self._wallet.lower()

        # SpreadCalculator/RiskController 는 mutable history 를 pair 별로
        # 들고 있어야 한다 (BNB/USDT 의 변동성이 ETH/USDT 와 섞이면 안 됨).
        self._spread_calc_by_pair: dict[str, SpreadCalculator] = {}
        self._risk_by_pair: dict[str, RiskController] = {}
        self._pair_states: dict[str, dict] = {}
        for p in settings.pairs:
            self._spread_calc_by_pair[p.token_pair] = SpreadCalculator(self._spread_cfg)
            self._risk_by_pair[p.token_pair] = RiskController(self._risk_cfg)
            self._pair_states[p.token_pair] = {
                "inventory": InventoryState(
                    initial_base=Decimal(str(p.initial_inventory_base)),
                    initial_quote=Decimal(str(p.initial_inventory_quote)),
                ),
                "last_mid": None,
                "last_quoted_mid": None,
                "prev_can_bid": None,
                "prev_can_ask": None,
                "active_buy": None,
                "active_sell": None,
            }

        self._lock = asyncio.Lock()
        self._decimals = _env_token_decimals()

    def on_match_outcomes(self, outcomes: list[dict], orderbook: OrderBook) -> None:
        if not self._wallet_lower:
            return
        for raw in outcomes:
            mid_id = raw.get("maker_order_id")
            tid_id = raw.get("taker_order_id")
            if not mid_id or not tid_id:
                continue
            maker_o = orderbook.get(mid_id)
            taker_o = orderbook.get(tid_id)
            try:
                m_fill = Decimal(str(raw.get("maker_fill_amount", "0")))
                t_fill = Decimal(str(raw.get("taker_fill_amount", "0")))
            except Exception:
                continue
            if m_fill <= 0 or t_fill <= 0:
                continue
            if taker_o and taker_o.wallet_address.lower() == self._wallet_lower:
                st = self._pair_states.get(taker_o.token_pair)
                if st:
                    st["inventory"].apply_mm_buy(m_fill, t_fill)
                    logger.info("MM 체결(매수): +base=%s -quote=%s", m_fill, t_fill)
            if maker_o and maker_o.wallet_address.lower() == self._wallet_lower:
                st = self._pair_states.get(maker_o.token_pair)
                if st:
                    st["inventory"].apply_mm_sell(m_fill, t_fill)
                    logger.info("MM 체결(매도): -base=%s +quote=%s", m_fill, t_fill)

    async def run_forever(self) -> None:
        self._running = True
        logger.info(
            "MM 봇 시작 wallet=%s onchain=%s",
            self._wallet or "(none)",
            self._escrow.enabled,
        )
        for pair in self._cfg.pairs:
            self._binance_ws.subscribe(pair.token_pair)
        self._binance_ws.start()
        try:
            while self._running:
                try:
                    for pair in self._cfg.pairs:
                        await self._tick_pair(pair.token_pair)
                except asyncio.CancelledError:
                    break
                except Exception:
                    logger.exception("MM 봇 틱 실패")
                await asyncio.sleep(self._refresh_sec)
        finally:
            await self._binance_ws.stop()
            logger.info("MM 봇 종료")

    def stop(self) -> None:
        self._running = False

    async def _tick_pair(self, token_pair: str) -> None:
        st = self._pair_states.get(token_pair)
        if st is None:
            return

        spread_calc = self._spread_calc_by_pair[token_pair]
        risk = self._risk_by_pair[token_pair]

        res = await self._price_feed.get_mid_price(token_pair)
        now = wall_time()

        if res.mid is None:
            risk.mark_feed_failed(True)
            async with self._lock:
                await self._cancel_all_mm_orders(token_pair)
            # 피드 복구 후에는 무조건 재주문이 필요하므로 threshold 기준점을 리셋
            st["last_quoted_mid"] = None
            return

        risk.mark_feed_failed(False)
        mid = res.mid
        risk.record_price(now, mid)
        spread_calc.record_mid(now, mid)

        if not risk.can_quote(now):
            async with self._lock:
                await self._cancel_all_mm_orders(token_pair)
            st["last_quoted_mid"] = None
            return

        inv: InventoryState = st["inventory"]
        spread_bps = spread_calc.effective_spread_bps()
        bid_px, ask_px = bid_ask_prices(mid, spread_bps)

        st["last_mid"] = mid

        can_bid = risk.can_quote_bid(inv, Decimal(str(mid)))
        can_ask = risk.can_quote_ask(inv, Decimal(str(mid)))

        # 가격 변화가 threshold 이내이고 side 판정이 그대로면 재주문 생략 →
        # 매 tick 마다 불필요한 cancel+deposit 체인으로 가스 낭비하지 않도록.
        if self._should_skip_refresh(st, mid, can_bid, can_ask):
            return

        async with self._lock:
            await self._refresh_quotes(token_pair, bid_px, ask_px, can_bid, can_ask)
        st["last_quoted_mid"] = mid
        st["prev_can_bid"] = can_bid
        st["prev_can_ask"] = can_ask

    def _should_skip_refresh(
        self,
        st: dict,
        mid: float,
        can_bid: bool,
        can_ask: bool,
    ) -> bool:
        last = st.get("last_quoted_mid")
        if last is None:
            return False
        if st.get("prev_can_bid") != can_bid or st.get("prev_can_ask") != can_ask:
            return False
        try:
            prev = float(last)
        except (TypeError, ValueError):
            return False
        if prev <= 0:
            return False
        change_pct = abs(mid - prev) / prev * 100.0
        return change_pct < self._refresh_threshold_pct

    async def _cancel_all_mm_orders(self, token_pair: str) -> None:
        st = self._pair_states[token_pair]
        for key in ("active_buy", "active_sell"):
            oid = st.get(key)
            if not oid:
                continue
            ok = await self._safe_cancel_order(oid)
            if ok:
                st[key] = None
            else:
                # 취소 확정 실패 → 에스크로에 예치가 남아있는 상태.
                # state 를 비우면 봇이 다음 tick 에 새 예치·주문을 만들어
                # 재고·에스크로 불일치를 일으킨다. 그대로 두면 다음 tick 의
                # _refresh_quotes 가 다시 취소를 재시도한다.
                logger.warning(
                    "MM 주문 취소 확정 실패 — state 유지 (다음 tick 재시도): order=%s",
                    oid[:8],
                )

    async def _safe_cancel_order(self, order_id: str) -> bool:
        """취소 확정 시 True, 확정 실패 시 False.

        Escrow 가 enabled 면 on-chain cancel 이 tx hash 를 돌려줘야 확정으로 간주.
        enabled 가 아니면 로컬 오더북에서만 제거하고 True.
        """
        # TEE 매칭이 이 주문을 스냅샷으로 잡고 있으면 취소 보류 — 다음 tick 에 재시도.
        # 매칭 중인 주문을 on-chain cancel 하면 executeSwap 이 revert 됨.
        if self._orderbook.is_locked(order_id):
            logger.debug("주문이 매칭 중이어서 취소 보류: %s", order_id[:8])
            return False

        # 로컬 오더북에서 먼저 제거 — on-chain cancel tx 를 기다리는 동안
        # TEE 매칭 사이클이 이 주문을 매칭해서 executeSwap 이 revert 되는
        # race 를 방지.
        o = self._orderbook.get(order_id)
        if o and o.is_active:
            try:
                self._orderbook.cancel(order_id)
            except (KeyError, ValueError):
                pass

        for attempt in range(3):
            try:
                if self._escrow.enabled:
                    txh = await asyncio.to_thread(self._escrow.cancel_order, order_id)
                    if txh is None:
                        if attempt < 2:
                            await asyncio.sleep(1.0)
                            continue
                        return False
                return True
            except Exception:
                logger.exception("MM 주문 취소 실패 order=%s attempt=%s", order_id[:8], attempt + 1)
                await asyncio.sleep(0.5)
        return False

    async def _refresh_quotes(
        self,
        token_pair: str,
        bid_px: Decimal,
        ask_px: Decimal,
        can_bid: bool,
        can_ask: bool,
    ) -> None:
        st = self._pair_states[token_pair]
        await self._cancel_all_mm_orders(token_pair)

        addr = self._wallet
        if not addr:
            logger.warning("MM_BOT_PRIVATE_KEY 없음 — 봇이 호가를 내지 않습니다.")
            return

        size = self._default_size

        if can_bid:
            buy_id = uuid.uuid4().hex
            usdt_amt = size * bid_px
            wei_q = decimal_to_wei(usdt_amt, self._decimals)
            txh = None
            for _ in range(3):
                txh = await asyncio.to_thread(
                    self._escrow.deposit, buy_id, self._quote_token, wei_q
                )
                if txh:
                    break
                await asyncio.sleep(0.8)
            if not txh:
                logger.error("MM 매수 예치 실패 — 비드 생략")
            else:
                buy = Order(
                    order_id=buy_id,
                    token_pair=token_pair,
                    side="buy",
                    amount=size,
                    limit_price=bid_px,
                    wallet_address=addr,
                )
                self._orderbook.add(buy)
                st["active_buy"] = buy_id

        if can_ask:
            sell_id = uuid.uuid4().hex
            wei_b = decimal_to_wei(size, self._decimals)
            txh = None
            for _ in range(3):
                txh = await asyncio.to_thread(
                    self._escrow.deposit, sell_id, self._base_token, wei_b
                )
                if txh:
                    break
                await asyncio.sleep(0.8)
            if not txh:
                logger.error("MM 매도 예치 실패 — 애스크 생략")
            else:
                sell = Order(
                    order_id=sell_id,
                    token_pair=token_pair,
                    side="sell",
                    amount=size,
                    limit_price=ask_px,
                    wallet_address=addr,
                )
                self._orderbook.add(sell)
                st["active_sell"] = sell_id

        # MM 이 새 호가를 올렸으니 매칭 사이클을 한 번 돌려서, 이미 대기 중인
        # 유저 주문이 새 호가와 크로스되면 체결시킨다. runner 의 pair lock 이
        # 중복 실행을 막아준다.
        asyncio.create_task(
            run_matching_cycle(self._orderbook, token_pair, self._ws, mm_bot=self)
        )
