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

        orders = self._book.active_orders(token_pair, "buy") + self._book.active_orders(
            token_pair, "sell"
        )
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
            return []

        # 유효 결과가 1개면 Judge 없이 바로 채택
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

        applied: list[MatchResult] = []
        if not validated.round_held and len(validated.rejected) == 0:
            for m in validated.accepted:
                self._book.fill(m.maker_order_id, m.maker_fill_amount)
                self._book.fill(m.taker_order_id, m.maker_fill_amount)
                applied.append(m)

        self.last_engine_used = winner_strategy
        self.last_reasoning = winner_result.get("reasoning", "")

        logger.info(
            "경쟁 매칭 완료: %s 채택, %d건 체결",
            winner_strategy,
            len(applied),
        )

        return applied
