"""동적 스프레드: 기본 bps × 변동성 배수, 상·하한."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass


@dataclass
class SpreadConfig:
    base_bps: float = 30.0
    min_bps: float = 10.0
    max_bps: float = 200.0
    vol_window_sec: float = 60.0
    vol_multiplier_max: float = 3.0


class SpreadCalculator:
    """effective_spread_bps = clamp(base_bps * vol_mult, min, max)."""

    def __init__(self, cfg: SpreadConfig) -> None:
        self._cfg = cfg
        self._history: deque[tuple[float, float]] = deque()

    def record_mid(self, now: float, mid: float) -> None:
        self._history.append((now, mid))
        cutoff = now - self._cfg.vol_window_sec
        while self._history and self._history[0][0] < cutoff:
            self._history.popleft()

    def volatility_multiplier(self) -> float:
        if len(self._history) < 2:
            return 1.0
        mids = [m for _, m in self._history]
        hi, lo = max(mids), min(mids)
        ref = sum(mids) / len(mids)
        if ref <= 0:
            return 1.0
        range_pct = (hi - lo) / ref * 100.0
        # 0% 변동 → 1.0, 약 2% 레인지에서 3.0 근처까지 선형
        extra = min(2.0, range_pct)
        mult = 1.0 + extra
        return min(self._cfg.vol_multiplier_max, mult)

    def effective_spread_bps(self) -> float:
        raw = self._cfg.base_bps * self.volatility_multiplier()
        return max(self._cfg.min_bps, min(self._cfg.max_bps, raw))
