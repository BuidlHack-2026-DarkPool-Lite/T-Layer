"""규칙 기반 매칭. Decimal 기반, OrderBook 직접 수정.

가격우선 → 시간우선(FIFO) → 부분체결. TEE 내부에서 동작.
"""

import logging
import uuid
from decimal import Decimal

from src.config import MIN_FILL_AMOUNT, SLIPPAGE_LIMIT_PCT
from src.models import MatchResult, Order, OrderBook

logger = logging.getLogger(__name__)


class RulesEngine:
    """가격우선 → 시간우선 → 부분체결 매칭.

    매칭 자체는 규칙 기반이라 투명하다.
    공정가 산출은 외부에서 주입받는다.
    """

    def __init__(
        self,
        orderbook: OrderBook,
        *,
        slippage_pct: float = SLIPPAGE_LIMIT_PCT,
        min_fill: float = MIN_FILL_AMOUNT,
    ) -> None:
        self._book = orderbook
        self._slippage_pct = Decimal(str(slippage_pct))
        self._min_fill = Decimal(str(min_fill))
        self.last_reasoning: str = ""

    def try_match(self, token_pair: str, fair_price: Decimal) -> list[MatchResult]:
        """대기 중인 주문들을 매칭 규칙에 따라 체결."""
        if fair_price <= 0:
            logger.warning("공정가가 0 이하(%s), 매칭 중단", fair_price)
            return []

        buys = self._sorted_buys(token_pair)
        sells = self._sorted_sells(token_pair)

        results: list[MatchResult] = []
        reasoning_parts: list[str] = []
        buy_idx = 0
        sell_idx = 0

        while buy_idx < len(buys) and sell_idx < len(sells):
            buy = buys[buy_idx]
            sell = sells[sell_idx]

            if not buy.is_active:
                buy_idx += 1
                continue
            if not sell.is_active:
                sell_idx += 1
                continue

            if buy.limit_price < sell.limit_price:
                break

            if not self._check_slippage(buy, fair_price):
                buy_idx += 1
                continue
            if not self._check_slippage(sell, fair_price):
                sell_idx += 1
                continue

            fill_qty = min(buy.remaining, sell.remaining)

            if fill_qty < self._min_fill:
                if buy.remaining <= sell.remaining:
                    buy_idx += 1
                if sell.remaining <= buy.remaining:
                    sell_idx += 1
                continue

            taker_fill = fill_qty * fair_price

            self._book.fill(buy.order_id, fill_qty)
            self._book.fill(sell.order_id, fill_qty)

            result = MatchResult(
                swap_id=uuid.uuid4().hex,
                maker_order_id=sell.order_id,
                taker_order_id=buy.order_id,
                maker_fill_amount=fill_qty,
                taker_fill_amount=taker_fill,
                exec_price=fair_price,
            )
            results.append(result)

            buy_improvement = (
                (buy.limit_price - fair_price) / buy.limit_price * 100
                if buy.limit_price > 0 else Decimal("0")
            )
            sell_improvement = (
                (fair_price - sell.limit_price) / sell.limit_price * 100
                if sell.limit_price > 0 else Decimal("0")
            )
            reasoning_parts.append(
                f"Matched buy@{buy.limit_price} with sell@{sell.limit_price}, "
                f"execution at fair price {fair_price}, fill {fill_qty} units. "
                f"Buyer saves {buy_improvement:.2f}% vs limit, "
                f"seller gains {sell_improvement:.2f}% vs limit."
            )

            logger.info(
                "매칭 체결: %s ← %s, qty=%s, price=%s",
                buy.order_id[:8],
                sell.order_id[:8],
                fill_qty,
                fair_price,
            )

            if not buy.is_active:
                buy_idx += 1
            if not sell.is_active:
                sell_idx += 1

        if results:
            n_buys = len(buys)
            n_sells = len(sells)
            total_fill = sum(r.maker_fill_amount for r in results)
            summary = (
                f"Analyzed {n_buys} buy and {n_sells} sell orders "
                f"using price-time priority matching. "
                f"Executed {len(results)} match(es), "
                f"total fill volume {total_fill} units "
                f"at fair price {fair_price}."
            )
            self.last_reasoning = (
                summary + " " + " ".join(reasoning_parts)
            )
        else:
            self.last_reasoning = (
                f"Analyzed {len(buys)} buy and {len(sells)} sell orders. "
                "No compatible price overlap found — no matches executed."
            )

        return results

    def _sorted_buys(self, token_pair: str) -> list[Order]:
        orders = self._book.active_orders(token_pair, "buy")
        return sorted(orders, key=lambda o: (-o.limit_price, o.created_at))

    def _sorted_sells(self, token_pair: str) -> list[Order]:
        orders = self._book.active_orders(token_pair, "sell")
        return sorted(orders, key=lambda o: (o.limit_price, o.created_at))

    def _check_slippage(self, order: Order, fair_price: Decimal) -> bool:
        if self._slippage_pct <= 0:
            return True
        limit = order.limit_price
        band = limit * self._slippage_pct / Decimal("100")
        if order.side == "buy":
            return fair_price <= limit + band
        else:
            return fair_price >= limit - band
