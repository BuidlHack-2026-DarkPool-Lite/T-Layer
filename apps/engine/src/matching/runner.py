"""백그라운드 매칭 사이클 — API 라우트와 MM 봇이 공유."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from src.matching.engine import MatchingEngine
from src.models import OrderBook
from src.signer.pipeline import process_match_results
from src.ws import ConnectionManager

logger = logging.getLogger(__name__)


async def run_matching_cycle(
    orderbook: OrderBook,
    token_pair: str,
    ws_manager: ConnectionManager,
    *,
    mm_bot: Any | None = None,
) -> None:
    """매칭 → 서명 → 제출 → WS 알림. MM 봇은 체결 후 재고 갱신 훅을 받는다."""
    try:
        engine = MatchingEngine(orderbook)
        results = await engine.run_matching_cycle(token_pair)
        if not results:
            return

        outcomes = await asyncio.to_thread(process_match_results, results)

        if mm_bot is not None and hasattr(mm_bot, "on_match_outcomes"):
            try:
                mm_bot.on_match_outcomes(outcomes, orderbook)
            except Exception:
                logger.exception("MM 봇 on_match_outcomes 실패")

        await ws_manager.broadcast({
            "action": "matched",
            "results": outcomes,
            "engine_used": engine.last_engine_used,
            "reasoning": engine.last_reasoning,
        })

        submitted = [o for o in outcomes if o.get("tx_hash")]
        if submitted:
            logger.info(
                "매칭 사이클 완료: %d건 체결, %d건 BSC 제출",
                len(results),
                len(submitted),
            )
        else:
            logger.info("매칭 사이클 완료: %d건 체결 (BSC 미설정)", len(results))
    except Exception:
        logger.exception("매칭 사이클 실패: token_pair=%s", token_pair)
