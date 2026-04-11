"""가격 급변, 피드 실패, 재고·노출 한도."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.mm_bot.inventory import InventoryState


@dataclass
class RiskConfig:
    max_exposure_pct: float = 70.0
    rebalance_threshold_pct: float = 60.0
    price_shock_pct: float = 5.0
    price_shock_window_sec: float = 60.0
    min_inventory_pct: float = 5.0


class RiskController:
    """베이스 비중이 70% 넘으면 비드 중단, 30% 미만이면 애스크 중단(대칭)."""

    def __init__(self, cfg: RiskConfig) -> None:
        self._cfg = cfg
        self._prices: deque[tuple[float, float]] = deque()
        self._feed_failed = False
        self._paused_until: float = 0.0

    def mark_feed_failed(self, failed: bool) -> None:
        self._feed_failed = failed

    def record_price(self, now: float, mid: float) -> None:
        self._prices.append((now, mid))
        cutoff = now - self._cfg.price_shock_window_sec
        while self._prices and self._prices[0][0] < cutoff:
            self._prices.popleft()

        if len(self._prices) >= 2:
            oldest = self._prices[0][1]
            if oldest > 0:
                change_pct = abs(mid - oldest) / oldest * 100.0
                if change_pct >= self._cfg.price_shock_pct:
                    self._paused_until = now + float(self._cfg.price_shock_window_sec)

    def is_shock_paused(self, now: float) -> bool:
        return now < self._paused_until

    def can_quote(self, now: float) -> bool:
        if self._feed_failed:
            return False
        return not self.is_shock_paused(now)

    def can_quote_bid(self, inv: InventoryState, mid: Decimal) -> bool:
        if inv.initial_quote <= 0:
            return True
        min_q = inv.initial_quote * Decimal(str(self._cfg.min_inventory_pct / 100.0))
        if inv.quote < min_q:
            return False
        hi = self._cfg.max_exposure_pct / 100.0
        if inv.base_share(mid) > hi:
            return False
        return True

    def can_quote_ask(self, inv: InventoryState, mid: Decimal) -> bool:
        if inv.initial_base <= 0:
            return True
        min_b = inv.initial_base * Decimal(str(self._cfg.min_inventory_pct / 100.0))
        if inv.base < min_b:
            return False
        lo = 1.0 - self._cfg.max_exposure_pct / 100.0
        if inv.base_share(mid) < lo:
            return False
        return True
