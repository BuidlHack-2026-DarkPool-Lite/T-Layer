"""API 요청/응답 스키마."""

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class OrderCreateRequest(BaseModel):
    token_pair: str
    side: Literal["buy", "sell"]
    amount: Decimal = Field(gt=0)
    limit_price: Decimal = Field(gt=0)
    wallet_address: str


class OrderResponse(BaseModel):
    order_id: str
    token_pair: str
    side: str
    amount: str
    filled_amount: str
    remaining: str
    limit_price: str
    wallet_address: str
    status: str
    created_at: str
    tx_hash: str | None = None
    engine_used: str | None = None
    reasoning: str | None = None
    judge_reasoning: str | None = None
    scores: list[dict] | None = None
    exec_price: str | None = None


class AttestationResponse(BaseModel):
    """TEE attestation 검증 응답 — frontend AttestationResult 매핑."""

    model_config = ConfigDict(extra="forbid")

    success: bool
    enclave_measurement: str
    signing_addresses: list[str]
    gpu_verified: bool
    gpu_model: str
    gpu_count: int = 0
    app_name: str = ""
    compose_hash: str = ""
    code_integrity: str
    timestamp: str


class ErrorResponse(BaseModel):
    detail: str
