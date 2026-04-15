"""매칭 결과 → 서명 → BSC 제출 파이프라인."""

import logging
from decimal import Decimal

from web3 import Web3

from src.config import BSC_CHAIN_ID, ESCROW_CONTRACT_ADDRESS, TEE_PRIVATE_KEY
from src.models.match import MatchResult
from src.signer.hash_builder import build_swap_struct_hash, to_bytes32
from src.signer.signer import get_signer_address, sign_swap
from src.signer.submitter import (
    DARKPOOL_ESCROW_ABI,
    _make_w3,
    build_execute_swap_tx,
    sign_and_send_tx,
)

logger = logging.getLogger(__name__)


def _to_wei(amount_decimal: Decimal) -> int:
    """Decimal 금액을 uint256(wei) 정수로 변환. 18 decimals 기준."""
    return int(amount_decimal * 10**18)


def sign_match(match: MatchResult) -> tuple[bytes, bytes] | None:
    """MatchResult에 ECDSA 서명을 생성한다.

    Returns:
        (signature, struct_hash) 또는 TEE_PRIVATE_KEY 미설정 시 None
    """
    if not TEE_PRIVATE_KEY:
        logger.warning("TEE_PRIVATE_KEY 미설정, 서명 건너뜀")
        return None

    if not ESCROW_CONTRACT_ADDRESS:
        logger.warning("ESCROW_CONTRACT_ADDRESS 미설정, 서명 건너뜀")
        return None

    struct_hash = build_swap_struct_hash(
        chain_id=BSC_CHAIN_ID,
        contract_address=ESCROW_CONTRACT_ADDRESS,
        swap_id=match.swap_id,
        maker_order_id=match.maker_order_id,
        taker_order_id=match.taker_order_id,
        maker_fill_amount=_to_wei(match.maker_fill_amount),
        taker_fill_amount=_to_wei(match.taker_fill_amount),
    )

    signature, msg_hash = sign_swap(struct_hash, TEE_PRIVATE_KEY)
    logger.info(
        "서명 생성: swap_id=%s, msg_hash=%s",
        match.swap_id[:8],
        msg_hash[:16],
    )
    return signature, struct_hash


def _preflight_orders_active(
    w3: Web3,
    maker_order_id: str,
    taker_order_id: str,
    maker_fill_wei: int,
    taker_fill_wei: int,
) -> bool:
    """executeSwap 전 on-chain 주문 상태 체크 — race 로 인한 revert 방지.

    컨트랙트의 orders 매핑과 getOrderRemaining 을 조회해서
    active=true 이고 remaining >= fill 인지 확인.
    """
    assert ESCROW_CONTRACT_ADDRESS is not None
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(ESCROW_CONTRACT_ADDRESS),
        abi=DARKPOOL_ESCROW_ABI,
    )
    for label, order_id, fill_wei in (
        ("maker", maker_order_id, maker_fill_wei),
        ("taker", taker_order_id, taker_fill_wei),
    ):
        order_bytes = to_bytes32(order_id)
        order = contract.functions.orders(order_bytes).call()
        # orders returns (trader, token, totalAmount, filledAmount, active)
        active = bool(order[4])
        if not active:
            logger.info(
                "executeSwap 스킵 — %s 주문 이미 비활성: %s",
                label, order_id[:8],
            )
            return False
        remaining = contract.functions.getOrderRemaining(order_bytes).call()
        if remaining < fill_wei:
            logger.info(
                "executeSwap 스킵 — %s 주문 잔량 부족: id=%s remaining=%d fill=%d",
                label, order_id[:8], remaining, fill_wei,
            )
            return False
    return True


def submit_match(match: MatchResult, signature: bytes) -> str | None:
    """서명된 매칭 결과를 BSC에 제출한다.

    Returns:
        tx_hash 또는 실패/미설정 시 None
    """
    if not TEE_PRIVATE_KEY or not ESCROW_CONTRACT_ADDRESS:
        logger.warning("BSC 설정 미완료, 제출 건너뜀")
        return None

    try:
        w3 = _make_w3()
        sender = get_signer_address(TEE_PRIVATE_KEY)

        maker_fill_wei = _to_wei(match.maker_fill_amount)
        taker_fill_wei = _to_wei(match.taker_fill_amount)
        if not _preflight_orders_active(
            w3,
            match.maker_order_id,
            match.taker_order_id,
            maker_fill_wei,
            taker_fill_wei,
        ):
            return None

        nonce = w3.eth.get_transaction_count(Web3.to_checksum_address(sender))

        tx = build_execute_swap_tx(
            swap_id=to_bytes32(match.swap_id),
            maker_order_id=to_bytes32(match.maker_order_id),
            taker_order_id=to_bytes32(match.taker_order_id),
            maker_fill_amount=maker_fill_wei,
            taker_fill_amount=taker_fill_wei,
            tee_signature=signature,
            sender_address=sender,
            nonce=nonce,
        )

        tx_hash = sign_and_send_tx(tx, TEE_PRIVATE_KEY)
        logger.info("BSC 제출 완료: swap_id=%s, tx=%s", match.swap_id[:8], tx_hash[:16])
        return tx_hash
    except Exception:
        logger.exception("BSC 제출 실패: swap_id=%s", match.swap_id[:8])
        return None


def process_match_results(results: list[MatchResult]) -> list[dict]:
    """매칭 결과 리스트를 서명 + 제출 처리한다.

    Returns:
        각 결과의 처리 상태 리스트.
    """
    outcomes: list[dict] = []
    for match in results:
        outcome: dict = {
            "swap_id": match.swap_id,
            "maker_order_id": match.maker_order_id,
            "taker_order_id": match.taker_order_id,
            "maker_fill_amount": str(match.maker_fill_amount),
            "taker_fill_amount": str(match.taker_fill_amount),
            "exec_price": str(match.exec_price),
        }

        signed = sign_match(match)
        if signed is None:
            outcome["signed"] = False
            outcome["tx_hash"] = None
            outcomes.append(outcome)
            continue

        signature, _ = signed
        outcome["signed"] = True

        tx_hash = submit_match(match, signature)
        outcome["tx_hash"] = tx_hash
        outcomes.append(outcome)

    return outcomes
