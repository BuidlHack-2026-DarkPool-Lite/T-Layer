"""NEAR AI Cloud + NVIDIA attestation API 클라이언트."""

import asyncio
import logging

import httpx

from src.config import NEARAI_CLOUD_API_KEY, NEARAI_CLOUD_BASE_URL, NVIDIA_ATTESTATION_URL

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_SEC = 30.0
RETRY_COUNT = 3


async def _get_with_retry(
    client: httpx.AsyncClient, url: str, **kwargs: object
) -> httpx.Response | None:
    last_exc: Exception | None = None
    for attempt in range(RETRY_COUNT):
        try:
            resp = await client.get(url, **kwargs)  # type: ignore[arg-type]
            resp.raise_for_status()
            return resp
        except Exception as exc:
            last_exc = exc
            if attempt < RETRY_COUNT - 1:
                await asyncio.sleep(0.5 * (attempt + 1))
    if last_exc is not None:
        logger.warning("GET 재시도 모두 실패: url=%s err=%s", url, last_exc)
    return None


async def _post_with_retry(
    client: httpx.AsyncClient, url: str, **kwargs: object
) -> httpx.Response | None:
    last_exc: Exception | None = None
    for attempt in range(RETRY_COUNT):
        try:
            resp = await client.post(url, **kwargs)  # type: ignore[arg-type]
            resp.raise_for_status()
            return resp
        except Exception as exc:
            last_exc = exc
            if attempt < RETRY_COUNT - 1:
                await asyncio.sleep(0.5 * (attempt + 1))
    if last_exc is not None:
        logger.warning("POST 재시도 모두 실패: url=%s err=%s", url, last_exc)
    return None


async def fetch_attestation_report(model: str) -> dict | None:
    """NEAR AI Cloud에서 모델의 attestation report를 조회한다."""
    if not NEARAI_CLOUD_API_KEY:
        logger.error("NEARAI_CLOUD_API_KEY가 설정되지 않음")
        return None

    url = f"{NEARAI_CLOUD_BASE_URL}/v1/attestation/report"
    headers = {
        "Authorization": f"Bearer {NEARAI_CLOUD_API_KEY}",
        "Content-Type": "application/json",
    }
    params = {"model": model}

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SEC) as client:
        resp = await _get_with_retry(client, url, headers=headers, params=params)
        return resp.json() if resp is not None else None


async def verify_gpu_attestation(nvidia_payload: str) -> dict | None:
    """NVIDIA attestation 서비스로 GPU attestation을 검증한다."""
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SEC) as client:
        resp = await _post_with_retry(
            client,
            NVIDIA_ATTESTATION_URL,
            headers={
                "accept": "application/json",
                "content-type": "application/json",
            },
            content=nvidia_payload,
        )
        return resp.json() if resp is not None else None
