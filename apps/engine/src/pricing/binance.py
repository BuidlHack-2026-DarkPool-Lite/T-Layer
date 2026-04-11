"""Binance REST API 가격 수집 모듈."""

from __future__ import annotations

import logging
from typing import Any, Final

import httpx

logger = logging.getLogger(__name__)

TICKER_PRICE_URL: Final[str] = "https://api.binance.com/api/v3/ticker/price"
REQUEST_TIMEOUT_SEC: Final[float] = 2.0

_PAIR_SYMBOLS: Final[dict[str, str]] = {
    "BNB/USDT": "BNBUSDT",
    "WBNB/USDT": "BNBUSDT",
}


def _normalize_token_pair(token_pair: str) -> str | None:
    key = token_pair.strip().upper().replace(" ", "")
    if key in _PAIR_SYMBOLS:
        return key
    if key == "BNB-USDT":
        return "BNB/USDT"
    return None


def binance_symbol(token_pair: str) -> str | None:
    """token_pair 를 Binance REST/WS 심볼(대문자)로 변환. 지원 안 되면 None."""
    norm = _normalize_token_pair(token_pair)
    if norm is None:
        return None
    return _PAIR_SYMBOLS[norm]


async def fetch_binance_price(token_pair: str) -> float | None:
    """Binance `GET /api/v3/ticker/price`로 심볼 현재가를 조회해 float로 반환한다."""
    norm = _normalize_token_pair(token_pair)
    if norm is None:
        logger.warning("unsupported token_pair for Binance feed: %r", token_pair)
        return None

    symbol = _PAIR_SYMBOLS[norm]

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SEC) as client:
            response = await client.get(
                TICKER_PRICE_URL,
                params={"symbol": symbol},
            )
            response.raise_for_status()
            body: Any = response.json()
    except Exception:
        logger.exception("Binance ticker request failed for pair %s", norm)
        return None

    if not isinstance(body, dict):
        logger.warning("Binance ticker unexpected JSON type for %s: %r", norm, type(body))
        return None

    raw_price = body.get("price")
    if raw_price is None:
        logger.warning("Binance ticker missing price field for %s: %s", norm, body)
        return None

    try:
        return float(raw_price)
    except (TypeError, ValueError):
        logger.exception("invalid price from Binance for %s: %r", norm, raw_price)
        return None
