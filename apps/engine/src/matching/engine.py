"""매칭 오케스트레이터.

pricing.quote → 변동성 체크 → rules_engine(+ optional LLM dual-pass) → OrderBook.fill().
"""

from __future__ import annotations

import asyncio
import copy
import logging
import os
from decimal import Decimal

from src.matching.llm_engine import call_matching
from src.matching.rules_engine import RulesEngine
from src.matching.state import matching_state
from src.matching.validator import validate_matching_result
from src.models import MatchResult, OrderBook
from src.pricing.quote import get_pricing_quote

logger = logging.getLogger(__name__)

_FLOAT_TOL = 1e-9
_MAX_VOLATILITY = 0.02


def _use_llm_matching() -> bool:
    v = os.environ.get("USE_LLM_MATCHING", "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _volatility_holds_round(fair_price: float, prev: float | None) -> bool:
    if prev is None or abs(prev) <= _FLOAT_TOL:
        return False
    change = abs(fair_price - prev) / abs(prev)
    return change > _MAX_VOLATILITY + _FLOAT_TOL


class MatchingEngine:
    """통합 매칭 오케스트레이터.

    pricing → volatility → rules (+ optional LLM dual-pass) → OrderBook 반영.
    """

    def __init__(self, orderbook: OrderBook) -> None:
        self._book = orderbook
        self.last_engine_used: str = "rules"
        self.last_reasoning: str = ""

    async def run_matching_cycle(self, token_pair: str) -> list[MatchResult]:
        """매칭 사이클을 실행한다.

        Returns:
            이번 사이클에서 발생한 체결 결과 목록.
            실패 시 빈 리스트.
        """
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

        # 3. 매칭 실행
        active_buys = self._book.active_orders(token_pair, "buy")
        active_sells = self._book.active_orders(token_pair, "sell")
        active_count = len(active_buys) + len(active_sells)

        if _use_llm_matching() and active_count >= 3:
            results = await self._dual_pass(token_pair, fair_price, fair_decimal, slippage_pct)
        else:
            rules = RulesEngine(self._book, slippage_pct=slippage_pct)
            results = rules.try_match(token_pair, fair_decimal)
            self.last_engine_used = "rules"
            self.last_reasoning = rules.last_reasoning

        # 4. 상태 업데이트
        matching_state.update_fair_price(fair_price)

        return results

    async def _dual_pass(
        self,
        token_pair: str,
        fair_price: float,
        fair_decimal: Decimal,
        slippage_pct: float,
    ) -> list[MatchResult]:
        """규칙 + LLM 병렬 실행, fill volume 큰 쪽 채택.

        양쪽 모두 OrderBook 스냅샷에서 실행하고, 승리한 결과만 실제 OrderBook에 적용.
        """
        orders = self._book.active_orders(token_pair, "buy") + self._book.active_orders(
            token_pair, "sell"
        )
        orders_snapshot = copy.deepcopy(orders)

        # 규칙 매칭용 OrderBook 복제
        rules_book = copy.deepcopy(self._book)

        async def _llm_coro() -> dict:
            try:
                return await asyncio.to_thread(call_matching, orders_snapshot, fair_price)
            except Exception:
                logger.exception("call_matching failed")
                return {"error": "exception"}

        rules_engine = RulesEngine(rules_book, slippage_pct=slippage_pct)

        async def _rules_coro() -> list[MatchResult]:
            return rules_engine.try_match(token_pair, fair_decimal)

        rules_results, raw_llm = await asyncio.gather(_rules_coro(), _llm_coro())

        rules_fill = sum(r.maker_fill_amount for r in rules_results)
        chosen = rules_results
        use_llm = False
        llm_reasoning = ""

        if isinstance(raw_llm, dict) and not raw_llm.get("error"):
            llm_reasoning = raw_llm.get("reasoning", "")
            validated = validate_matching_result(
                raw_llm, orders_snapshot, fair_price, matching_state.prev_fair_price
            )
            if not validated.round_held and len(validated.rejected) == 0:
                llm_fill = sum(m.maker_fill_amount for m in validated.accepted)
                if llm_fill > rules_fill:
                    chosen = validated.accepted
                    use_llm = True

        # 승리한 결과를 실제 OrderBook에 적용
        for m in chosen:
            self._book.fill(m.maker_order_id, m.maker_fill_amount)
            self._book.fill(m.taker_order_id, m.maker_fill_amount)

        self.last_engine_used = "llm" if use_llm else "rules"
        self.last_reasoning = llm_reasoning if use_llm else rules_engine.last_reasoning

        logger.info(
            "dual-pass 완료: %s, %d건 체결",
            "LLM 채택" if use_llm else "규칙 채택",
            len(chosen),
        )
        return chosen
