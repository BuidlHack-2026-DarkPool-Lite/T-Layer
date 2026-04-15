"""매칭 오케스트레이터.

pricing.quote → 변동성 체크 → competitive TEE matching → OrderBook.fill().
3개 전략이 TEE 안에서 병렬 경쟁 → Judge가 승자 선택.
"""

from __future__ import annotations

import asyncio
import copy
import logging
from decimal import Decimal

from src.matching.llm_engine import (
    call_conservative,
    call_free_optimizer,
    call_judge,
    call_volume_max,
)
from src.matching.state import matching_state
from src.matching.validator import validate_matching_result
from src.models import MatchResult, OrderBook
from src.pricing.quote import get_pricing_quote

logger = logging.getLogger(__name__)

_FLOAT_TOL = 1e-9
_MAX_VOLATILITY = 0.02

_STRATEGY_NAMES = ["conservative", "volume_max", "free_optimizer"]


def _volatility_holds_round(fair_price: float, prev: float | None) -> bool:
    if prev is None or abs(prev) <= _FLOAT_TOL:
        return False
    change = abs(fair_price - prev) / abs(prev)
    return change > _MAX_VOLATILITY + _FLOAT_TOL


class MatchingEngine:
    """통합 매칭 오케스트레이터.

    pricing → volatility → competitive TEE matching → OrderBook 반영.
    """

    def __init__(self, orderbook: OrderBook) -> None:
        self._book = orderbook
        self.last_engine_used: str = "none"
        self.last_reasoning: str = ""
        self.last_scores: list[dict] | None = None
        self.last_judge_reasoning: str = ""
        self.last_tee_verifications: list[dict] = []

    async def run_matching_cycle(self, token_pair: str) -> list[MatchResult]:
        """매칭 사이클 실행."""
        # 1. 공정가 산출
        quote = await get_pricing_quote(token_pair)
        if quote.error or quote.mid_price is None:
            logger.warning("가격 산출 실패: %s", quote.error)
            return []

        fair_price = quote.mid_price

        # 2. 변동성 체크
        if _volatility_holds_round(fair_price, matching_state.prev_fair_price):
            logger.warning(
                "라운드 중단: 공정가 변동 2%% 초과 (prev=%s, current=%s)",
                matching_state.prev_fair_price,
                fair_price,
            )
            matching_state.update_fair_price(fair_price)
            return []

        bps = quote.max_slippage_bps
        slippage_pct = (bps if bps is not None else 150) / 100.0
        fair_decimal = Decimal(str(fair_price))

        # 3. 매칭 실행 (항상 TEE 경쟁 매칭)
        results = await self._competitive_match(
            token_pair, fair_price, fair_decimal, slippage_pct
        )

        # 4. 상태 업데이트
        matching_state.update_fair_price(fair_price)

        return results

    async def _competitive_match(
        self,
        token_pair: str,
        fair_price: float,
        fair_decimal: Decimal,
        slippage_pct: float,
    ) -> list[MatchResult]:
        """3개 TEE 전략 병렬 경쟁 → Judge 선택 → OrderBook 반영."""

        buys = self._book.active_orders(token_pair, "buy")
        sells = self._book.active_orders(token_pair, "sell")

        # ── Wash-trade 사전 필터 ──────────────────────────────
        # 같은 지갑이 buy+sell 양쪽에 있으면 TEE가 자기매칭함.
        # dual-side 지갑의 주문 중, 다른 지갑이 이미 있는 쪽을 제거.
        wallet_buys = {o.wallet_address.lower() for o in buys}
        wallet_sells = {o.wallet_address.lower() for o in sells}
        dual_wallets = wallet_buys & wallet_sells

        if dual_wallets:
            non_dual_buys = wallet_buys - dual_wallets
            non_dual_sells = wallet_sells - dual_wallets

            if non_dual_buys or non_dual_sells:
                # non-dual 지갑이 있으면 기존 로직: dual 지갑의 반대쪽 제거
                if non_dual_buys:
                    buys = [o for o in buys if o.wallet_address.lower() not in dual_wallets]
                if non_dual_sells:
                    sells = [o for o in sells if o.wallet_address.lower() not in dual_wallets]
            else:
                # 모든 지갑이 dual — 각 dual 지갑은 한쪽만 유지 (교차 매칭 강제)
                # 지갑을 정렬하여 번갈아 buy/sell 할당
                sorted_duals = sorted(dual_wallets)
                keep_buy = set()   # 이 지갑은 buy만 유지
                keep_sell = set()  # 이 지갑은 sell만 유지
                for i, w in enumerate(sorted_duals):
                    if i % 2 == 0:
                        keep_buy.add(w)
                    else:
                        keep_sell.add(w)
                buys = [o for o in buys if o.wallet_address.lower() in keep_buy]
                sells = [o for o in sells if o.wallet_address.lower() in keep_sell]

            logger.info(
                "Wash-trade 필터: dual=%s, 필터 후 buy=%d, sell=%d",
                [w[:10] for w in dual_wallets], len(buys), len(sells),
            )

        orders = buys + sells
        logger.info(
            "매칭 오더북: buy=%d건, sell=%d건, 주문=%s",
            len(buys), len(sells),
            [(o.order_id[:8], o.side, float(o.amount), float(o.limit_price)) for o in orders],
        )
        if not buys or not sells:
            logger.info("매칭 불가: buy=%d, sell=%d — 양쪽 필요", len(buys), len(sells))
            return []

        orders_snapshot = copy.deepcopy(orders)

        # ── Step 1: 3개 전략 병렬 실행 (모두 NEAR AI TEE) ──
        async def _conservative():
            try:
                return await asyncio.to_thread(
                    call_conservative, orders_snapshot, fair_price
                )
            except Exception:
                logger.exception("call_conservative failed")
                return {"error": "exception", "_strategy": "conservative"}

        async def _volume_max():
            try:
                return await asyncio.to_thread(
                    call_volume_max, orders_snapshot, fair_price
                )
            except Exception:
                logger.exception("call_volume_max failed")
                return {"error": "exception", "_strategy": "volume_max"}

        async def _free_optimizer():
            try:
                return await asyncio.to_thread(
                    call_free_optimizer, orders_snapshot, fair_price
                )
            except Exception:
                logger.exception("call_free_optimizer failed")
                return {"error": "exception", "_strategy": "free_optimizer"}

        r1, r2, r3 = await asyncio.gather(
            _conservative(), _volume_max(), _free_optimizer()
        )

        raw_results = [r1, r2, r3]

        logger.info(
            "3개 전략 실행 완료: conservative=%s, volume_max=%s, free_optimizer=%s",
            "OK" if not r1.get("error") else r1["error"][:30],
            "OK" if not r2.get("error") else r2["error"][:30],
            "OK" if not r3.get("error") else r3["error"][:30],
        )

        # 에러 아닌 결과가 하나도 없으면 빈 리스트
        valid_results = [r for r in raw_results if not r.get("error")]
        if not valid_results:
            logger.error("모든 전략 실패, 매칭 없음")
            self.last_engine_used = "none"
            self.last_reasoning = "All 3 strategies failed"
            self.last_scores = None
            self.last_judge_reasoning = ""
            self.last_tee_verifications = []
            return []

        # 유효 결과가 1개면 Judge 없이 바로 채택
        verdict: dict | None = None
        if len(valid_results) == 1:
            winner_result = valid_results[0]
            winner_strategy = winner_result.get("_strategy", "unknown")
            logger.info("유효 결과 1개 (%s), Judge 생략", winner_strategy)
        else:
            # ── Step 2: Judge 호출 ──
            try:
                verdict = await asyncio.to_thread(
                    call_judge, orders_snapshot, fair_price, raw_results
                )
            except Exception:
                logger.exception("call_judge failed")
                verdict = {"error": "exception"}

            if verdict.get("error"):
                # Judge 실패 시 fill volume 가장 큰 결과 채택
                logger.warning("Judge 실패, fill volume 기준으로 선택")
                winner_result = max(
                    valid_results,
                    key=lambda r: sum(
                        m.get("fill_amount", 0) for m in r.get("matches", [])
                    ),
                )
                winner_strategy = winner_result.get("_strategy", "unknown")
                self.last_scores = None
                self.last_judge_reasoning = "Judge failed, fallback to max fill volume"
            else:
                winner_idx = verdict.get("winner", 0)
                if not isinstance(winner_idx, int) or winner_idx < 0 or winner_idx > 2:
                    winner_idx = 0
                winner_result = raw_results[winner_idx]
                winner_strategy = _STRATEGY_NAMES[winner_idx]
                self.last_scores = verdict.get("scores", [])
                self.last_judge_reasoning = verdict.get("reasoning", "")

                # Judge가 0건 매칭 전략을 골랐는데 다른 전략에 매칭이 있으면 override
                winner_matches = winner_result.get("matches", [])
                if not winner_matches:
                    alt = [r for r in valid_results if r.get("matches")]
                    if alt:
                        winner_result = max(
                            alt,
                            key=lambda r: sum(
                                m.get("fill_amount", 0) for m in r.get("matches", [])
                            ),
                        )
                        winner_strategy = winner_result.get("_strategy", "unknown")
                        logger.warning(
                            "Judge 선택(%s) 0건 매칭 → %s로 override",
                            _STRATEGY_NAMES[winner_idx], winner_strategy,
                        )

                logger.info(
                    "Judge 결과: winner=%s (idx=%d), scores=%s",
                    winner_strategy,
                    winner_idx,
                    self.last_scores,
                )

        # ── Step 3: 승자 결과를 OrderBook에 적용 ──
        validated = validate_matching_result(
            winner_result, orders_snapshot, fair_price, matching_state.prev_fair_price
        )

        logger.info(
            "Validator: accepted=%d, rejected=%d, round_held=%s, winner_matches=%s",
            len(validated.accepted), len(validated.rejected), validated.round_held,
            winner_result.get("matches", []),
        )

        applied: list[MatchResult] = []
        if not validated.round_held and len(validated.rejected) == 0:
            for m in validated.accepted:
                try:
                    self._book.fill(m.maker_order_id, m.maker_fill_amount)
                except ValueError as exc:
                    # MM bot 오더북 refresh 와의 race — TEE 검증된 매칭은 그대로 진행
                    logger.info(
                        "maker fill 스킵 (이미 비활성): %s", m.maker_order_id[:8],
                    )
                    logger.debug("maker fill exc: %s", exc)
                try:
                    self._book.fill(m.taker_order_id, m.maker_fill_amount)
                except ValueError as exc:
                    logger.info(
                        "taker fill 스킵 (이미 비활성): %s", m.taker_order_id[:8],
                    )
                    logger.debug("taker fill exc: %s", exc)
                # TEE 검증 완료된 매칭은 fill 실패와 무관하게 결과에 포함
                applied.append(m)

        self.last_engine_used = winner_strategy
        self.last_reasoning = winner_result.get("reasoning", "")

        # TEE 서명 검증 결과 수집 (3개 전략 + Judge)
        tee_verifications = []
        for r in raw_results:
            v = r.get("_tee_verification")
            if v:
                tee_verifications.append({
                    "strategy": r.get("_strategy", "unknown"),
                    "model": r.get("_model", ""),
                    **v,
                })
        # Judge 결과도 수집 (verdict가 존재하고 에러가 아닌 경우)
        if verdict is not None and not verdict.get("error"):
            jv = verdict.get("_tee_verification")
            if jv:
                tee_verifications.append({
                    "strategy": "judge",
                    "model": verdict.get("_model", ""),
                    **jv,
                })
        self.last_tee_verifications = tee_verifications

        logger.info(
            "경쟁 매칭 완료: %s 채택, %d건 체결, TEE 검증 %d/%d",
            winner_strategy,
            len(applied),
            sum(1 for v in tee_verifications if v.get("verified")),
            len(tee_verifications),
        )

        return applied
