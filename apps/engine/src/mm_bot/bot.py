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
from src.mm_bot.price_feed import PriceFeedListener, wall_time
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
        else:
            pw, bw = 0.6, 0.4
        self._price_feed = PriceFeedListener(
            pancake_weight=pw,
            binance_weight=bw,
            outlier_threshold_pct=float(pr.get("outlier_threshold_pct", 2.0)),
        )

        sp = settings.spread
        self._spread_calc = SpreadCalculator(
            SpreadConfig(
                base_bps=float(sp.get("base_bps", 30)),
                min_bps=float(sp.get("min_bps", 10)),
                max_bps=float(sp.get("max_bps", 200)),
                vol_window_sec=float(sp.get("vol_window_sec", 60)),
                vol_multiplier_max=float(sp.get("vol_multiplier_max", 3.0)),
            )
        )

        rk = settings.risk
        self._risk = RiskController(
            RiskConfig(
                max_exposure_pct=float(rk.get("max_exposure_pct", 70)),
                rebalance_threshold_pct=float(rk.get("rebalance_threshold_pct", 60)),
                price_shock_pct=float(rk.get("price_shock_pct", 5.0)),
                price_shock_window_sec=float(rk.get("price_shock_window_sec", 60)),
                min_inventory_pct=float(rk.get("min_inventory_pct", 5.0)),
            )
        )

        od = settings.order
        self._refresh_sec = float(od.get("refresh_interval_sec", 5))
        self._default_size = Decimal(str(od.get("default_size_base", 100)))

        oc = settings.onchain
        self._base_token = oc.base_token if oc else ""
        self._quote_token = oc.quote_token if oc else ""
        self._gas_gwei = oc.gas_price_gwei if oc else 10

        pk = os.environ.get("MM_BOT_PRIVATE_KEY", "").strip()
        self._escrow = MMEscrowClient(private_key=pk or None, gas_price_gwei=self._gas_gwei)

        self._wallet = self._escrow.address or ""
        self._wallet_lower = self._wallet.lower()

        self._pair_states: dict[str, dict] = {}
        for p in settings.pairs:
            self._pair_states[p.token_pair] = {
                "inventory": InventoryState(
                    initial_base=Decimal(str(p.initial_inventory_base)),
                    initial_quote=Decimal(str(p.initial_inventory_quote)),
                ),
                "last_mid": None,
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
        while self._running:
            try:
                for pair in self._cfg.pairs:
                    await self._tick_pair(pair.token_pair)
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("MM 봇 틱 실패")
            await asyncio.sleep(self._refresh_sec)
        logger.info("MM 봇 종료")

    def stop(self) -> None:
        self._running = False

    async def _tick_pair(self, token_pair: str) -> None:
        st = self._pair_states.get(token_pair)
        if st is None:
            return

        res = await self._price_feed.get_mid_price(token_pair)
        now = wall_time()

        if res.mid is None:
            self._risk.mark_feed_failed(True)
            async with self._lock:
                await self._cancel_all_mm_orders(token_pair)
            return

        self._risk.mark_feed_failed(False)
        mid = res.mid
        self._risk.record_price(now, mid)
        self._spread_calc.record_mid(now, mid)

        if not self._risk.can_quote(now):
            async with self._lock:
                await self._cancel_all_mm_orders(token_pair)
            return

        inv: InventoryState = st["inventory"]
        spread_bps = self._spread_calc.effective_spread_bps()
        bid_px, ask_px = bid_ask_prices(mid, spread_bps)

        st["last_mid"] = mid

        can_bid = self._risk.can_quote_bid(inv, Decimal(str(mid)))
        can_ask = self._risk.can_quote_ask(inv, Decimal(str(mid)))

        async with self._lock:
            await self._refresh_quotes(token_pair, bid_px, ask_px, can_bid, can_ask)

    async def _cancel_all_mm_orders(self, token_pair: str) -> None:
        st = self._pair_states[token_pair]
        for key in ("active_buy", "active_sell"):
            oid = st.get(key)
            if oid:
                await self._safe_cancel_order(oid)
                st[key] = None

    async def _safe_cancel_order(self, order_id: str) -> None:
        for attempt in range(3):
            try:
                if self._escrow.enabled:
                    txh = await asyncio.to_thread(self._escrow.cancel_order, order_id)
                    if txh is None and attempt < 2:
                        await asyncio.sleep(1.0)
                        continue
                o = self._orderbook.get(order_id)
                if o and o.is_active:
                    try:
                        self._orderbook.cancel(order_id)
                    except (KeyError, ValueError):
                        pass
                return
            except Exception:
                logger.exception("MM 주문 취소 실패 order=%s attempt=%s", order_id[:8], attempt + 1)
                await asyncio.sleep(0.5)

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

        await run_matching_cycle(self._orderbook, token_pair, self._ws, mm_bot=self)
