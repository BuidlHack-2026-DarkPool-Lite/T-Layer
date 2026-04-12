"""LLM 응답 JSON 스키마 / function calling 정의 모듈."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Final

_MATCH_RESULT_ITEM_SCHEMA: Final[dict[str, Any]] = {
    "type": "object",
    "properties": {
        "match_id": {"type": "string"},
        "maker_order_id": {"type": "string"},
        "maker_wallet": {"type": "string"},
        "taker_order_id": {"type": "string"},
        "taker_wallet": {"type": "string"},
        "token_pair": {"type": "string"},
        "fill_amount": {"type": "number"},
        "execution_price": {"type": "number"},
    },
    "required": [
        "match_id",
        "maker_order_id",
        "maker_wallet",
        "taker_order_id",
        "taker_wallet",
        "token_pair",
        "fill_amount",
        "execution_price",
    ],
    "additionalProperties": False,
}

_REMAINING_ORDER_ITEM_SCHEMA: Final[dict[str, Any]] = {
    "type": "object",
    "properties": {
        "order_id": {"type": "string"},
        "side": {"type": "string"},
        "token_pair": {"type": "string"},
        "original_amount": {"type": "number"},
        "remaining_amount": {"type": "number"},
        "limit_price": {"type": "number"},
        "wallet_addr": {"type": "string"},
    },
    "required": [
        "order_id",
        "side",
        "token_pair",
        "original_amount",
        "remaining_amount",
        "limit_price",
        "wallet_addr",
    ],
    "additionalProperties": False,
}

MATCHING_LLM_JSON_SCHEMA: Final[dict[str, Any]] = {
    "type": "object",
    "properties": {
        "matches": {"type": "array", "items": _MATCH_RESULT_ITEM_SCHEMA},
        "remaining_orders": {"type": "array", "items": _REMAINING_ORDER_ITEM_SCHEMA},
        "fair_price": {"type": "number"},
        "reasoning": {"type": "string"},
    },
    "required": ["matches", "remaining_orders", "fair_price", "reasoning"],
    "additionalProperties": False,
}

_RESPONSE_FORMAT_NAME: Final[str] = "darkpool_matching_result"


def get_response_format() -> dict[str, Any]:
    return {
        "type": "json_schema",
        "json_schema": {
            "name": _RESPONSE_FORMAT_NAME,
            "strict": True,
            "schema": deepcopy(MATCHING_LLM_JSON_SCHEMA),
        },
    }
