"""주문 도메인 모델."""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal, Self

from pydantic import BaseModel, Field, model_validator

OrderSide = Literal["buy", "sell"]
OrderStatus = Literal["pending", "partial", "filled", "cancelled"]


class Order(BaseModel):
    """TEE 내부 주문 표현. 컨트랙트 Order 구조체와 1:1 대응."""

    order_id: str
    token_pair: str
    side: OrderSide
    amount: Decimal = Field(gt=0)
    filled_amount: Decimal = Field(default=Decimal("0"), ge=0)
    limit_price: Decimal = Field(gt=0)
    wallet_address: str
    status: OrderStatus = "pending"
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @model_validator(mode="after")
    def _check_filled_not_exceeds_amount(self) -> Self:
        if self.filled_amount > self.amount:
            raise ValueError(f"filled_amount({self.filled_amount})가 amount({self.amount})를 초과")
        if self.status == "filled" and self.filled_amount != self.amount:
            raise ValueError(
                f"status가 filled인데 filled_amount({self.filled_amount}) != amount({self.amount})"
            )
        if self.status in ("pending", "partial") and self.filled_amount >= self.amount:
            raise ValueError(
                f"status가 {self.status}인데 잔량 없음 "
                f"(filled_amount={self.filled_amount}, amount={self.amount})"
            )
        return self

    @property
    def remaining(self) -> Decimal:
        return self.amount - self.filled_amount

    @property
    def is_active(self) -> bool:
        return self.status in ("pending", "partial")
