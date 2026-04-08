"""BSC 컨트랙트 executeSwap 트랜잭션 빌드 및 전송."""

import json
import logging
from pathlib import Path

from web3 import Web3

from src.config import BSC_CHAIN_ID, BSC_TESTNET_RPC, ESCROW_CONTRACT_ADDRESS

logger = logging.getLogger(__name__)

_RPC_TIMEOUT_SEC = 30


def _find_repo_root() -> Path:
    """packages/contracts-abi 디렉토리를 가진 가장 가까운 조상을 찾는다.

    parents[N] 같은 고정 깊이 인덱스는 모듈 위치가 바뀌면 조용히 깨지므로
    upward-search로 모노레포 루트를 찾는다.
    """
    for ancestor in Path(__file__).resolve().parents:
        if (ancestor / "packages" / "contracts-abi").is_dir():
            return ancestor
    raise FileNotFoundError(
        "packages/contracts-abi 디렉토리를 어떤 조상에서도 찾을 수 없음 — "
        "모노레포 구조가 깨졌거나 'npm run compile'이 한 번도 실행되지 않았다."
    )


_ABI_PATH = _find_repo_root() / "packages" / "contracts-abi" / "DarkPoolEscrow.json"

try:
    _abi_doc = json.loads(_ABI_PATH.read_text(encoding="utf-8"))
except json.JSONDecodeError as exc:
    raise ValueError(f"ABI JSON 파싱 실패: {_ABI_PATH}") from exc

if not isinstance(_abi_doc, dict) or not isinstance(_abi_doc.get("abi"), list):
    raise ValueError(
        f"ABI 스키마 비정상: {_ABI_PATH} 에 dict + 'abi' list 필드가 있어야 함"
    )

DARKPOOL_ESCROW_ABI = _abi_doc["abi"]


def _make_w3() -> Web3:
    return Web3(Web3.HTTPProvider(BSC_TESTNET_RPC, request_kwargs={"timeout": _RPC_TIMEOUT_SEC}))


def build_execute_swap_tx(
    swap_id: bytes,
    maker_order_id: bytes,
    taker_order_id: bytes,
    maker_fill_amount: int,
    taker_fill_amount: int,
    tee_signature: bytes,
    sender_address: str,
    nonce: int,
    *,
    gas: int = 300_000,
    gas_price_gwei: int = 5,
) -> dict:
    """executeSwap 트랜잭션 딕셔너리를 빌드한다."""
    if not ESCROW_CONTRACT_ADDRESS:
        raise ValueError("ESCROW_CONTRACT_ADDRESS가 설정되지 않음")
    w3 = _make_w3()
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(ESCROW_CONTRACT_ADDRESS),
        abi=DARKPOOL_ESCROW_ABI,
    )

    tx = contract.functions.executeSwap(
        swap_id,
        maker_order_id,
        taker_order_id,
        maker_fill_amount,
        taker_fill_amount,
        tee_signature,
    ).build_transaction(
        {
            "chainId": BSC_CHAIN_ID,
            "gas": gas,
            "gasPrice": w3.to_wei(gas_price_gwei, "gwei"),
            "nonce": nonce,
            "from": sender_address,
        }
    )
    return tx


def sign_and_send_tx(tx: dict, private_key: str) -> str:
    """트랜잭션을 서명하고 전송한다. tx hash를 반환."""
    w3 = _make_w3()
    signed = w3.eth.account.sign_transaction(tx, private_key)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    logger.info("executeSwap tx 전송: %s", tx_hash.hex())
    return tx_hash.hex()
