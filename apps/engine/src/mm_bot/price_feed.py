"""PancakeSwap + Binance 가중 평균, 이상치 시 단일 소스.

Binance 쪽은 bookTicker WebSocket 스트림(BinanceWsFeed)을 우선 경로로 쓰고,
연결이 끊겼거나 stale 이면 기존 REST polling 으로 fallback 한다.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from dataclasses import dataclass

import websockets

from src.pricing.binance import binance_symbol, fetch_binance_price
from src.pricing.pancakeswap import fetch_pancakeswap_price

logger = logging.getLogger(__name__)

BINANCE_WS_BASE = "wss://stream.binance.com:9443/ws"


@dataclass
class MidPriceResult:
    mid: float | None
    pancake: float | None
    binance: float | None
    outlier_downgraded: bool
    error: str | None = None


def _parse_book_ticker(raw: str | bytes) -> float | None:
    """bookTicker 페이로드에서 (bid+ask)/2 mid 를 추출.

    비-JSON / 필드 누락 / 음수 / 0 은 None (호출자가 fallback 경로로 빠지도록).
    """
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    b = data.get("b")
    a = data.get("a")
    if b is None or a is None:
        return None
    try:
        bid = float(b)
        ask = float(a)
    except (TypeError, ValueError):
        return None
    if bid <= 0 or ask <= 0:
        return None
    # crossed top-of-book 은 Binance bookTicker 에서 발생 불가. 나왔다면
    # corrupted payload 이므로 뒤집힌 mid 로 호가를 내지 않도록 거절.
    if bid > ask:
        return None
    return (bid + ask) / 2.0


class BinanceWsFeed:
    """Binance bookTicker WS 스트림 → in-memory mid 캐시.

    - subscribe(token_pair): 구독 심볼 등록 (start 이전에만 호출)
    - start(): pair 별 영구 WS 태스크 생성
    - latest(token_pair): 최신 mid (cache miss 또는 stale 이면 None)
    - stop(): 태스크 cancel + await
    """

    def __init__(
        self,
        *,
        stale_threshold_sec: float = 10.0,
        backoff_initial: float = 0.5,
        backoff_max: float = 10.0,
        ping_interval: float = 20.0,
        ping_timeout: float = 20.0,
    ) -> None:
        self._stale = stale_threshold_sec
        self._backoff_initial = backoff_initial
        self._backoff_max = backoff_max
        self._ping_interval = ping_interval
        self._ping_timeout = ping_timeout
        self._subs: dict[str, str] = {}  # token_pair → 소문자 심볼 (URL 용)
        self._cache: dict[str, tuple[float, float]] = {}  # token_pair → (mid, ts)
        self._tasks: list[asyncio.Task] = []
        self._stopping = False

    def _now(self) -> float:
        return time.monotonic()

    def subscribe(self, token_pair: str) -> bool:
        sym = binance_symbol(token_pair)
        if sym is None:
            logger.warning(
                "BinanceWsFeed: 지원 안 되는 pair %s — REST fallback 만 사용",
                token_pair,
            )
            return False
        self._subs[token_pair] = sym.lower()
        return True

    def start(self) -> None:
        if self._tasks:
            return
        self._stopping = False
        for pair, sym in self._subs.items():
            t = asyncio.create_task(self._run_stream(pair, sym))
            self._tasks.append(t)
        logger.info("BinanceWsFeed 시작: %d pair", len(self._tasks))

    async def stop(self) -> None:
        self._stopping = True
        for t in self._tasks:
            t.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        logger.info("BinanceWsFeed 정지")

    def latest(self, token_pair: str) -> float | None:
        entry = self._cache.get(token_pair)
        if entry is None:
            return None
        mid, ts = entry
        if (self._now() - ts) > self._stale:
            return None
        return mid

    async def _run_stream(self, token_pair: str, symbol: str) -> None:
        url = f"{BINANCE_WS_BASE}/{symbol}@bookTicker"
        backoff = self._backoff_initial
        while not self._stopping:
            try:
                async with websockets.connect(
                    url,
                    ping_interval=self._ping_interval,
                    ping_timeout=self._ping_timeout,
                ) as ws:
                    logger.info("BinanceWsFeed 연결: %s", url)
                    backoff = self._backoff_initial
                    async for message in ws:
                        mid = _parse_book_ticker(message)
                        if mid is not None:
                            self._cache[token_pair] = (mid, self._now())
            except asyncio.CancelledError:
                break
            except Exception as e:
                # Full jitter: [0, backoff) — thundering herd 방지 표준 관행.
                jittered = random.random() * backoff
                logger.warning(
                    "BinanceWsFeed %s 연결 끊김, %.2fs(jittered, cap=%.1f) 후 재시도: %s",
                    symbol,
                    jittered,
                    backoff,
                    e,
                )
                try:
                    await asyncio.sleep(jittered)
                except asyncio.CancelledError:
                    break
                backoff = min(backoff * 2.0, self._backoff_max)


class PriceFeedListener:
    """스펙: Pancake 60% + Binance 40%, 편차 > threshold 시 한 소스 제외."""

    def __init__(
        self,
        *,
        pancake_weight: float = 0.6,
        binance_weight: float = 0.4,
        outlier_threshold_pct: float = 2.0,
        outlier_primary: str = "binance",
        binance_ws: BinanceWsFeed | None = None,
    ) -> None:
        self._wp = pancake_weight
        self._wb = binance_weight
        self._threshold = outlier_threshold_pct
        self._primary = outlier_primary if outlier_primary in ("binance", "pancake") else "binance"
        self._binance_ws = binance_ws

    async def _fetch_binance(self, token_pair: str) -> float | None:
        if self._binance_ws is not None:
            cached = self._binance_ws.latest(token_pair)
            if cached is not None:
                return cached
        return await fetch_binance_price(token_pair)

    async def get_mid_price(self, token_pair: str) -> MidPriceResult:
        pancake, binance = await asyncio.gather(
            fetch_pancakeswap_price(token_pair),
            self._fetch_binance(token_pair),
        )

        if pancake is None and binance is None:
            return MidPriceResult(
                mid=None,
                pancake=None,
                binance=None,
                outlier_downgraded=False,
                error="all feeds failed",
            )

        if pancake is not None and binance is not None:
            spread = abs(pancake - binance)
            lo = min(pancake, binance)
            diff_pct = (spread / lo * 100.0) if lo > 0 else 0.0
            if diff_pct > self._threshold:
                chosen = binance if self._primary == "binance" else pancake
                logger.warning(
                    "MM price feed: outlier %.2f%% > %.2f%%, using %s only",
                    diff_pct,
                    self._threshold,
                    self._primary,
                )
                return MidPriceResult(
                    mid=chosen,
                    pancake=pancake,
                    binance=binance,
                    outlier_downgraded=True,
                    error=None,
                )
            mid = pancake * self._wp + binance * self._wb
            return MidPriceResult(
                mid=mid,
                pancake=pancake,
                binance=binance,
                outlier_downgraded=False,
                error=None,
            )

        if pancake is not None:
            return MidPriceResult(
                mid=pancake,
                pancake=pancake,
                binance=None,
                outlier_downgraded=False,
                error=None,
            )
        return MidPriceResult(
            mid=binance,
            pancake=None,
            binance=binance,
            outlier_downgraded=False,
            error=None,
        )

    async def poll_loop_sleep(self, interval_sec: float) -> None:
        await asyncio.sleep(interval_sec)


def wall_time() -> float:
    return time.monotonic()
