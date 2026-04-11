"""MM 지갑 — ERC20 approve / Escrow deposit·cancel (web3.py)."""

from __future__ import annotations

import logging
import os
from decimal import ROUND_DOWN, Decimal

from eth_account import Account
from web3 import Web3

from src.config import BSC_CHAIN_ID, BSC_TESTNET_RPC, ESCROW_CONTRACT_ADDRESS
from src.signer.hash_builder import to_bytes32
from src.signer.submitter import DARKPOOL_ESCROW_ABI

logger = logging.getLogger(__name__)

_RPC_TIMEOUT_SEC = 30

ERC20_MIN_ABI = [
    {
        "name": "approve",
        "type": "function",
        "inputs": [
            {"name": "spender", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "outputs": [{"type": "bool"}],
        "stateMutability": "nonpayable",
    },
    {
        "name": "allowance",
        "type": "function",
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "spender", "type": "address"},
        ],
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
    },
]


def decimal_to_wei(amount: Decimal, decimals: int) -> int:
    scale = Decimal(10) ** decimals
    return int((amount * scale).quantize(Decimal(1), rounding=ROUND_DOWN))


class MMEscrowClient:
    def __init__(
        self,
        *,
        private_key: str | None,
        gas_price_gwei: int = 10,
        dry_run: bool = False,
    ) -> None:
        self._pk = (private_key or "").strip() or None
        self._gas_gwei = gas_price_gwei
        self._dry_run = dry_run or os.environ.get("MM_BOT_DRY_RUN", "").lower() in (
            "1",
            "true",
            "yes",
        )

    @property
    def enabled(self) -> bool:
        return bool(self._pk) and bool(ESCROW_CONTRACT_ADDRESS) and not self._dry_run

    @property
    def address(self) -> str | None:
        if not self._pk:
            return None
        return Account.from_key(self._pk).address

    def _w3(self) -> Web3:
        return Web3(
            Web3.HTTPProvider(
                BSC_TESTNET_RPC,
                request_kwargs={"timeout": _RPC_TIMEOUT_SEC},
            )
        )

    def _sign_and_send(self, tx: dict) -> str | None:
        assert self._pk is not None
        w3 = self._w3()
        signed = w3.eth.account.sign_transaction(tx, self._pk)
        h = w3.eth.send_raw_transaction(signed.raw_transaction)
        rx = w3.eth.wait_for_transaction_receipt(h, timeout=120)
        if rx.get("status") != 1:
            logger.error("MM on-chain tx 실패: %s", h.hex())
            return None
        return h.hex()

    def ensure_allowance(self, token: str, spender: str, need: int) -> bool:
        if not self.enabled:
            return True
        assert self._pk is not None
        w3 = self._w3()
        acct = Account.from_key(self._pk)
        c = w3.eth.contract(address=Web3.to_checksum_address(token), abi=ERC20_MIN_ABI)
        cur = c.functions.allowance(acct.address, Web3.to_checksum_address(spender)).call()
        if cur >= need:
            return True

        nonce = w3.eth.get_transaction_count(Web3.to_checksum_address(acct.address))
        tx = c.functions.approve(Web3.to_checksum_address(spender), 2**256 - 1).build_transaction(
            {
                "chainId": BSC_CHAIN_ID,
                "from": acct.address,
                "nonce": nonce,
                "gas": 100_000,
                "gasPrice": w3.to_wei(self._gas_gwei, "gwei"),
            }
        )
        return self._sign_and_send(tx) is not None

    def deposit(self, order_id_hex: str, token: str, amount_wei: int) -> str | None:
        if self._dry_run or not self._pk:
            logger.info("MM deposit 스킵 (dry-run 또는 키 없음) order=%s", order_id_hex[:8])
            return "dry-run"

        if not ESCROW_CONTRACT_ADDRESS:
            logger.warning("ESCROW_CONTRACT_ADDRESS 미설정 — MM deposit 스킵")
            return None

        if not self.ensure_allowance(token, ESCROW_CONTRACT_ADDRESS, amount_wei):
            logger.error("MM approve 실패 token=%s", token[:10])
            return None

        w3 = self._w3()
        acct = Account.from_key(self._pk)
        esc = w3.eth.contract(
            address=Web3.to_checksum_address(ESCROW_CONTRACT_ADDRESS),
            abi=DARKPOOL_ESCROW_ABI,
        )
        oid = to_bytes32(order_id_hex)
        nonce = w3.eth.get_transaction_count(Web3.to_checksum_address(acct.address))
        tx = esc.functions.deposit(
            oid,
            Web3.to_checksum_address(token),
            amount_wei,
        ).build_transaction(
            {
                "chainId": BSC_CHAIN_ID,
                "from": acct.address,
                "nonce": nonce,
                "gas": 350_000,
                "gasPrice": w3.to_wei(self._gas_gwei, "gwei"),
            }
        )
        return self._sign_and_send(tx)

    def cancel_order(self, order_id_hex: str) -> str | None:
        if self._dry_run or not self._pk:
            return "dry-run"
        if not ESCROW_CONTRACT_ADDRESS:
            return None

        w3 = self._w3()
        acct = Account.from_key(self._pk)
        esc = w3.eth.contract(
            address=Web3.to_checksum_address(ESCROW_CONTRACT_ADDRESS),
            abi=DARKPOOL_ESCROW_ABI,
        )
        oid = to_bytes32(order_id_hex)
        nonce = w3.eth.get_transaction_count(Web3.to_checksum_address(acct.address))
        tx = esc.functions.cancelOrder(oid).build_transaction(
            {
                "chainId": BSC_CHAIN_ID,
                "from": acct.address,
                "nonce": nonce,
                "gas": 250_000,
                "gasPrice": w3.to_wei(self._gas_gwei, "gwei"),
            }
        )
        return self._sign_and_send(tx)
