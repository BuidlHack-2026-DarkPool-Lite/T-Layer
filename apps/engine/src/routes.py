"""주문 API 라우터."""

import asyncio
import logging
import time
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect

from src.attestation.verifier import verify_attestation
from src.config import NEAR_AI_MODEL, NEARAI_CLOUD_API_KEY
from src.matching.runner import run_matching_cycle
from src.models import Order, OrderBook
from src.schemas import AttestationResponse, OrderCreateRequest, OrderResponse
from src.ws import ConnectionManager

logger = logging.getLogger(__name__)

router = APIRouter()

# attestation 응답 캐시 — NEAR AI / NVIDIA API 가 간헐적으로 느리거나 503 을
# 뱉는 경우가 있어, 성공한 응답을 잠깐 재사용해서 UX 를 안정화.
_ATTESTATION_CACHE: dict[str, tuple[float, AttestationResponse]] = {}
_ATTESTATION_TTL_SEC = 300.0
_ATTESTATION_LOCK = asyncio.Lock()


def _get_orderbook(request: Request) -> OrderBook:
    return request.app.state.orderbook


def _order_to_response(order: Order) -> OrderResponse:
    return OrderResponse(
        order_id=order.order_id,
        token_pair=order.token_pair,
        side=order.side,
        amount=str(order.amount),
        filled_amount=str(order.filled_amount),
        remaining=str(order.remaining),
        limit_price=str(order.limit_price),
        wallet_address=order.wallet_address,
        status=order.status,
        created_at=order.created_at.isoformat(),
        tx_hash=order.tx_hash,
        engine_used=order.engine_used,
        reasoning=order.reasoning,
        judge_reasoning=order.judge_reasoning,
        scores=order.scores,
        exec_price=order.exec_price,
    )


@router.post("/order", response_model=OrderResponse, status_code=201)
async def create_order(body: OrderCreateRequest, request: Request) -> OrderResponse:
    """주문 생성. order_id는 서버에서 uuid4로 생성. 생성 후 매칭 사이클 자동 실행."""
    order_id = uuid.uuid4().hex
    order = Order(
        order_id=order_id,
        token_pair=body.token_pair,
        side=body.side,
        amount=body.amount,
        limit_price=body.limit_price,
        wallet_address=body.wallet_address,
    )
    orderbook = _get_orderbook(request)
    orderbook.add(order)
    response = _order_to_response(order)
    manager: ConnectionManager = request.app.state.ws_manager
    try:
        await manager.broadcast({"action": "created", "order": response.model_dump()})
    except Exception:
        logger.exception("broadcast 실패 (created, order_id=%s)", order_id)

    mm_bot = getattr(request.app.state, "mm_bot", None)
    task = asyncio.create_task(
        run_matching_cycle(orderbook, body.token_pair, manager, mm_bot=mm_bot)
    )
    bg_tasks: set = getattr(request.app.state, "background_tasks", None) or set()
    request.app.state.background_tasks = bg_tasks
    bg_tasks.add(task)
    task.add_done_callback(bg_tasks.discard)

    return response


@router.get("/order/{order_id}/status", response_model=OrderResponse)
async def get_order_status(order_id: str, request: Request) -> OrderResponse:
    """주문 상태 조회."""
    orderbook = _get_orderbook(request)
    order = orderbook.get(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail=f"주문을 찾을 수 없음: {order_id}")
    return _order_to_response(order)


@router.delete("/order/{order_id}", response_model=OrderResponse)
async def cancel_order(order_id: str, request: Request) -> OrderResponse:
    """주문 취소. 미체결 잔량은 컨트랙트에서 환불."""
    orderbook = _get_orderbook(request)
    try:
        order = orderbook.cancel(order_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"주문을 찾을 수 없음: {order_id}") from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    response = _order_to_response(order)
    try:
        manager: ConnectionManager = request.app.state.ws_manager
        await manager.broadcast({"action": "cancelled", "order": response.model_dump()})
    except Exception:
        logger.exception("broadcast 실패 (cancelled, order_id=%s)", order_id)
    return response


@router.get("/attestation/verify", response_model=AttestationResponse)
async def verify_attestation_endpoint() -> AttestationResponse:
    """TEE attestation 검증 결과를 반환한다. 5분 캐시."""
    if not NEARAI_CLOUD_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="attestation backend not configured",
        )

    now = time.monotonic()
    cached = _ATTESTATION_CACHE.get(NEAR_AI_MODEL)
    if cached is not None and now - cached[0] < _ATTESTATION_TTL_SEC:
        return cached[1]

    # 동시 요청이 모두 upstream 을 두드리지 않도록 직렬화.
    async with _ATTESTATION_LOCK:
        cached = _ATTESTATION_CACHE.get(NEAR_AI_MODEL)
        if cached is not None and time.monotonic() - cached[0] < _ATTESTATION_TTL_SEC:
            return cached[1]

        try:
            result = await verify_attestation(NEAR_AI_MODEL)
        except Exception as exc:
            logger.exception("attestation 검증 중 예외 발생")
            # 최근 성공한 응답이 있으면 stale 로 반환 — 데모 안정성 우선.
            if cached is not None:
                logger.warning("attestation 실패, 최근 캐시 반환")
                return cached[1]
            raise HTTPException(status_code=500, detail="Internal server error") from exc

        if not result.success:
            if cached is not None:
                logger.warning("attestation 실패(%s), 최근 캐시 반환", result.error)
                return cached[1]
            raise HTTPException(
                status_code=503, detail=result.error or "attestation 검증 실패"
            )

        response = AttestationResponse(
            success=result.success,
            enclave_measurement=result.enclave_measurement,
            signing_addresses=result.signing_addresses,
            gpu_verified=result.gpu_verified,
            gpu_model=result.gpu_model,
            gpu_count=result.gpu_count,
            app_name=result.app_name,
            compose_hash=result.compose_hash,
            code_integrity="matching_engine v0.1.0",
            timestamp=datetime.now(UTC).isoformat(),
        )
        _ATTESTATION_CACHE[NEAR_AI_MODEL] = (time.monotonic(), response)
        return response


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """실시간 체결 알림 WebSocket."""
    manager: ConnectionManager = websocket.app.state.ws_manager
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)
