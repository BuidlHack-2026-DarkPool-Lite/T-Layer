from dotenv import load_dotenv
load_dotenv()

"""환경변수 기반 통합 설정."""

import os

# --- BSC ---
BSC_TESTNET_RPC = os.getenv("BSC_RPC_URL", "https://data-seed-prebsc-1-s1.binance.org:8545")
BSC_CHAIN_ID = int(os.getenv("BSC_CHAIN_ID", "97"))

TEE_PRIVATE_KEY = os.getenv("TEE_PRIVATE_KEY", "")
ESCROW_CONTRACT_ADDRESS = os.getenv("ESCROW_CONTRACT_ADDRESS", "")

# --- Attestation ---
NEARAI_CLOUD_API_KEY = os.getenv("NEARAI_CLOUD_API_KEY", "")
NEARAI_CLOUD_BASE_URL = os.getenv("NEARAI_CLOUD_BASE_URL", "https://cloud-api.near.ai")
NVIDIA_ATTESTATION_URL = os.getenv(
    "NVIDIA_ATTESTATION_URL", "https://nras.attestation.nvidia.com/v3/attest/gpu"
)

NEAR_AI_MODEL = os.getenv("NEAR_AI_MODEL", "deepseek-ai/DeepSeek-V3.1")

# --- Pricing / Slippage ---
SLIPPAGE_LIMIT_PCT = float(os.getenv("SLIPPAGE_LIMIT_PCT", "1.5"))
MIN_FILL_AMOUNT = float(os.getenv("MIN_FILL_AMOUNT", "0"))
