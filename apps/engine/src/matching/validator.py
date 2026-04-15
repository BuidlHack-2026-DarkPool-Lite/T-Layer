"""LLM 매칭 JSON 후검증 (USE_LLM_MATCHING=1 경로).

규칙 엔진 출력은 결정론적이므로 이 모듈을 거치지 않는다.
LLM 출력(float/str)을 Decimal로 변환·검증한 뒤, 통과된 매칭을 MatchResult로 변환한다.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from src.models.match import MatchResult
from src.models.order import Order

MAX_VOLATILITY = 0.02
_FLOAT_TOL = 1e-9


@dataclass(frozen=True)
class ValidatedResult:
    accepted: list[MatchResult]
    rejected: list[dict[str, Any]]
    round_held: bool


def validate_matching_result(
    raw_result: dict[str, Any],
    orders: list[Order],
    fair_price: float,
    prev_fair_price: float | None,
) -> ValidatedResult:
    """LLM raw_result의 matches를 주문/규칙에 맞게 검증한다."""
    order_map: dict[str, Order] = {o.order_id: o for o in orders}
    rejected: list[dict[str, Any]] = []
    accepted: list[MatchResult] = []
    cumulative_fill: dict[str, Decimal] = {}

    raw_matches = raw_result.get("matches")
    if raw_matches is None:
        raw_matches = []
    if not isinstance(raw_matches, list):
        return ValidatedResult(
            accepted=[],
            rejected=[{"match": raw_matches, "reason": "matches 필드가 배열이 아님"}],
            round_held=False,
        )

    for raw in raw_matches:
        if not isinstance(raw, dict):
            rejected.append({"match": raw, "reason": "매칭 항목이 객체(dict)가 아님"})
            continue

        maker_id = raw.get("maker_order_id")
        taker_id = raw.get("taker_order_id")
        raw_fill = raw.get("fill_amount")
        raw_price = raw.get("execution_price")

        if not all(v is not None for v in (maker_id, taker_id, raw_fill, raw_price)):
            rejected.append({"match": raw, "reason": "필수 필드 누락"})
            continue

        try:
            fill_dec = Decimal(str(raw_fill))
            price_dec = Decimal(str(raw_price))
        except (InvalidOperation, TypeError, ValueError):
            rejected.append({"match": raw, "reason": "fill_amount 또는 execution_price 파싱 실패"})
            continue

        maker = order_map.get(maker_id)
        taker = order_map.get(taker_id)
        if maker is None:
            rejected.append({
                "match": raw,
                "reason": f"존재하지 않는 maker_order_id: {maker_id!r}",
            })
            continue
        if taker is None:
            rejected.append({
                "match": raw,
                "reason": f"존재하지 않는 taker_order_id: {taker_id!r}",
            })
            continue

        if maker.side != "sell":
            rejected.append({"match": raw, "reason": "maker 주문은 sell 이어야 함"})
            continue
        if taker.side != "buy":
            rejected.append({"match": raw, "reason": "taker 주문은 buy 이어야 함"})
            continue
        if maker.wallet_address.lower() == taker.wallet_address.lower():
            rejected.append({"match": raw, "reason": "같은 지갑 간 매칭 불가 (wash trading)"})
            continue

        # 체결가 보정: LLM이 잘못 계산해도 매수/매도 limit이 호환되면 재계산
        fair_dec = Decimal(str(fair_price))
        if price_dec > taker.limit_price or price_dec < maker.limit_price:
            # limit이 호환되는지 먼저 확인 (buy.limit >= sell.limit)
            if taker.limit_price < maker.limit_price:
                rejected.append({
                    "match": raw,
                    "reason": (
                        f"매수 limit({taker.limit_price}) < 매도 limit({maker.limit_price}), "
                        "가격 비호환"
                    ),
                })
                continue
            # 체결가: fair_price 를 [sell_limit, buy_limit] 로 clamp.
            # 이렇게 하면 양쪽 limit 를 만족하면서 유저·MM 양측에 가장 공정한
            # 가격이 나옴. midpoint fallback 은 유저에게 불리할 수 있어 제거.
            if fair_dec < maker.limit_price:
                price_dec = maker.limit_price  # fair 가 너무 낮으면 maker 최소가
            elif fair_dec > taker.limit_price:
                price_dec = taker.limit_price  # fair 가 너무 높으면 taker 최대가
            else:
                price_dec = fair_dec
            import logging as _log
            _log.getLogger(__name__).info(
                "체결가 보정: LLM=%s → 재계산=%s (fair=%s, buy_limit=%s, sell_limit=%s)",
                raw_price, price_dec, fair_dec, taker.limit_price, maker.limit_price,
            )

        if fill_dec <= 0:
            rejected.append({
                "match": raw,
                "reason": f"fill_amount는 양수여야 함: {fill_dec}",
            })
            continue

        new_maker = cumulative_fill.get(maker_id, Decimal(0)) + fill_dec
        new_taker = cumulative_fill.get(taker_id, Decimal(0)) + fill_dec
        # remaining 기준 검증 — 이미 부분 체결된 주문이면 잔량 안에서만 허용.
        # amount 기준으로 비교하면 이전 사이클의 체결을 무시해서 on-chain
        # "exceeds remaining" revert 를 부른다.
        maker_room = maker.amount - maker.filled_amount
        taker_room = taker.amount - taker.filled_amount
        if new_maker > maker_room:
            rejected.append({
                "match": raw,
                "reason": f"maker_order_id 누적 체결량({new_maker})이 잔량({maker_room}) 초과",
            })
            continue
        if new_taker > taker_room:
            rejected.append({
                "match": raw,
                "reason": f"taker_order_id 누적 체결량({new_taker})이 잔량({taker_room}) 초과",
            })
            continue

        cumulative_fill[maker_id] = new_maker
        cumulative_fill[taker_id] = new_taker

        accepted.append(
            MatchResult(
                swap_id=uuid.uuid4().hex,
                maker_order_id=maker_id,
                taker_order_id=taker_id,
                maker_fill_amount=fill_dec,
                taker_fill_amount=fill_dec * price_dec,
                exec_price=price_dec,
            )
        )

    round_held = False
    if prev_fair_price is not None and abs(prev_fair_price) > _FLOAT_TOL:
        change = abs(fair_price - prev_fair_price) / abs(prev_fair_price)
        if change > MAX_VOLATILITY + _FLOAT_TOL:
            round_held = True
            for m in accepted:
                rejected.append({
                    "match": m.model_dump(mode="json"),
                    "reason": (
                        "라운드 보류: 공정가 변동이 2% 초과 "
                        f"(prev={prev_fair_price}, current={fair_price}, change={change:.4f})"
                    ),
                })
            accepted = []

    return ValidatedResult(accepted=accepted, rejected=rejected, round_held=round_held)
