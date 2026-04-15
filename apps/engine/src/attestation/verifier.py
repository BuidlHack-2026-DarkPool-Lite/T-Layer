"""TEE attestation 검증 로직."""

import base64
import json
import logging
from dataclasses import dataclass, field

from src.attestation.client import fetch_attestation_report, verify_gpu_attestation

logger = logging.getLogger(__name__)


@dataclass
class AttestationResult:
    """attestation 검증 결과."""

    success: bool
    signing_addresses: list[str] = field(default_factory=list)
    gpu_verified: bool = False
    gpu_results: list[dict] = field(default_factory=list)
    enclave_measurement: str = ""
    gpu_model: str = ""
    gpu_count: int = 0
    app_name: str = ""
    compose_hash: str = ""
    error: str | None = None


def extract_enclave_measurement(report: dict) -> str:
    """NEAR AI report 에서 enclave measurement 추출.

    우선순위:
    1. model_attestations[0].info.mr_aggregated (Intel TDX 측정값 — 실제 enclave id)
    2. model_attestations[0].enclave_measurement (legacy)
    3. top-level enclave_measurement
    """
    for att in report.get("model_attestations") or []:
        if not isinstance(att, dict):
            continue
        info = att.get("info")
        if isinstance(info, dict):
            mr = info.get("mr_aggregated")
            if mr:
                return str(mr)
        em = att.get("enclave_measurement")
        if em:
            return str(em)
    em = report.get("enclave_measurement")
    if em:
        return str(em)
    return ""


def extract_tdx_identity(report: dict) -> tuple[str, str]:
    """NEAR AI report 에서 (app_name, compose_hash) 추출."""
    for att in report.get("model_attestations") or []:
        if not isinstance(att, dict):
            continue
        info = att.get("info")
        if isinstance(info, dict):
            app = str(info.get("app_name") or "")
            ch = str(info.get("compose_hash") or "")
            return app, ch
    return "", ""


def extract_nvidia_arch_from_payload(payload_str: str) -> tuple[str, int]:
    """nvidia_payload JSON 문자열에서 (arch, gpu_count) 추출."""
    import json as _json
    try:
        p = _json.loads(payload_str)
    except Exception:
        return "", 0
    arch = str(p.get("arch") or "")
    evidence = p.get("evidence_list") or []
    return arch, len(evidence) if isinstance(evidence, list) else 0


def extract_gpu_model_from_jwt(gpu_resp: dict | list) -> str:
    """NVIDIA GPU attestation 응답의 JWT에서 GPU 모델명을 추출한다."""
    token = _extract_jwt_token(gpu_resp)
    if not token:
        return ""
    payload = decode_nvidia_jwt_payload(token)
    if not payload:
        return ""
    return str(
        payload.get("x-nvidia-hwmodel")
        or payload.get("x-nvidia-gpu-arch")
        or ""
    )


def extract_signing_addresses(report: dict) -> list[str]:
    addresses: list[str] = []
    model_attestations = report.get("model_attestations", [])
    for att in model_attestations:
        addr = att.get("signing_address")
        if addr and addr not in addresses:
            addresses.append(addr)
    return addresses


def extract_nvidia_payloads(report: dict) -> list[str]:
    payloads: list[str] = []
    model_attestations = report.get("model_attestations", [])
    for att in model_attestations:
        payload = att.get("nvidia_payload")
        if payload:
            payloads.append(payload)
    return payloads


def _extract_jwt_token(gpu_resp: dict | list) -> str | None:
    if isinstance(gpu_resp, list):
        for item in gpu_resp:
            if isinstance(item, list) and len(item) >= 2 and isinstance(item[1], str):
                return item[1]
            if isinstance(item, str) and item.count(".") == 2:
                return item
        return None

    if isinstance(gpu_resp, dict):
        for value in gpu_resp.values():
            if isinstance(value, str) and value.count(".") == 2:
                return value

    return None


def decode_nvidia_jwt_payload(jwt_token: str) -> dict | None:
    try:
        parts = jwt_token.split(".")
        if len(parts) != 3:
            return None
        payload_b64 = parts[1]
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += "=" * padding
        payload_bytes = base64.urlsafe_b64decode(payload_b64)
        return json.loads(payload_bytes)
    except Exception:
        logger.exception("NVIDIA JWT 디코딩 실패")
        return None


async def verify_attestation(model: str) -> AttestationResult:
    """모델의 TEE attestation을 검증하는 전체 파이프라인."""
    report = await fetch_attestation_report(model)
    if report is None:
        return AttestationResult(success=False, error="attestation report 조회 실패")

    addresses = extract_signing_addresses(report)
    if not addresses:
        return AttestationResult(success=False, error="signing address 없음")

    logger.info("TEE signing addresses: %s", addresses)

    enclave_measurement = extract_enclave_measurement(report)
    app_name, compose_hash = extract_tdx_identity(report)

    nvidia_payloads = extract_nvidia_payloads(report)
    gpu_results: list[dict] = []
    all_passed = True
    gpu_model = ""
    gpu_count = 0

    # NEAR AI 의 nvidia_payload 에서 직접 arch / gpu_count 추출.
    # 여기서 얻는 arch (예: 'HOPPER') 는 실제 TDX 안에서 검증된 GPU 하드웨어 사양.
    for payload in nvidia_payloads:
        arch, count = extract_nvidia_arch_from_payload(payload)
        if arch:
            gpu_model = arch
        if count > gpu_count:
            gpu_count = count

    for i, payload in enumerate(nvidia_payloads):
        gpu_resp = await verify_gpu_attestation(payload)
        if gpu_resp is None:
            gpu_results.append({"index": i, "passed": False, "error": "검증 요청 실패"})
            all_passed = False
            continue

        # JWT 에 hwmodel 있으면 우선 사용 (더 구체적인 모델명).
        jwt_model = extract_gpu_model_from_jwt(gpu_resp)
        if jwt_model:
            gpu_model = jwt_model

        eat_token = _extract_jwt_token(gpu_resp)

        if eat_token:
            jwt_payload = decode_nvidia_jwt_payload(eat_token)
            overall_result = (
                jwt_payload.get("x-nvidia-overall-att-result", False) if jwt_payload else False
            )
        else:
            overall_result = False

        gpu_results.append({"index": i, "passed": bool(overall_result)})
        if not overall_result:
            all_passed = False

    gpu_verified = all_passed and len(nvidia_payloads) > 0

    if not nvidia_payloads:
        logger.warning("NVIDIA payload 없음 — GPU attestation 건너뜀")

    return AttestationResult(
        success=True,
        signing_addresses=addresses,
        gpu_verified=gpu_verified,
        gpu_results=gpu_results,
        enclave_measurement=enclave_measurement,
        gpu_model=gpu_model,
        gpu_count=gpu_count,
        app_name=app_name,
        compose_hash=compose_hash,
    )
