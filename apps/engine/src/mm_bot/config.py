"""mm_config.yaml 로드."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None

logger = logging.getLogger(__name__)


@dataclass
class MMOnchainConfig:
    base_token: str
    quote_token: str
    gas_price_gwei: int = 10


@dataclass
class MMPairConfig:
    token_pair: str
    initial_inventory_base: float = 1000.0
    initial_inventory_quote: float = 300_000.0


@dataclass
class MMSettings:
    enabled: bool = False
    pairs: list[MMPairConfig] = field(default_factory=list)
    pricing: dict[str, Any] = field(default_factory=dict)
    spread: dict[str, Any] = field(default_factory=dict)
    risk: dict[str, Any] = field(default_factory=dict)
    order: dict[str, Any] = field(default_factory=dict)
    onchain: MMOnchainConfig | None = None


def _default_config_path() -> Path:
    return Path(__file__).resolve().parents[2] / "mm_config.yaml"


def load_mm_settings(path: Path | None = None) -> MMSettings:
    if yaml is None:
        logger.warning("PyYAML 미설치 — MM 봇 비활성 (uv sync 로 pyyaml 설치)")
        return MMSettings(enabled=False)

    cfg_path = path or _default_config_path()
    if not cfg_path.is_file():
        logger.info("mm_config.yaml 없음 — MM 봇 비활성: %s", cfg_path)
        return MMSettings(enabled=False)

    try:
        raw = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("mm_config.yaml 파싱 실패 — MM 봇 비활성")
        return MMSettings(enabled=False)

    if not isinstance(raw, dict):
        logger.warning("mm_config.yaml 루트가 매핑이 아님 — MM 봇 비활성")
        return MMSettings(enabled=False)

    mm = raw.get("mm_bot")
    if not isinstance(mm, dict):
        logger.info("mm_config.yaml 에 mm_bot 섹션 없음 — MM 봇 비활성")
        return MMSettings(enabled=False)

    if not bool(mm.get("enabled", False)):
        return MMSettings(enabled=False)

    def _as_dict(v: Any) -> dict[str, Any]:
        return v if isinstance(v, dict) else {}

    pairs_raw = mm.get("pairs")
    pairs: list[MMPairConfig] = []
    if isinstance(pairs_raw, list):
        for p in pairs_raw:
            if not isinstance(p, dict):
                continue
            tp_raw = p.get("token_pair") or f"{p.get('base', 'BNB')}/{p.get('quote', 'USDT')}"
            tp = str(tp_raw).strip()
            try:
                init_base = float(p.get("initial_inventory_base", 1000))
                init_quote = float(p.get("initial_inventory_quote", 300_000))
            except (TypeError, ValueError):
                logger.warning("mm_config pair 재고 값 파싱 실패 — 기본값 사용: %s", tp)
                init_base, init_quote = 1000.0, 300_000.0
            pairs.append(
                MMPairConfig(
                    token_pair=tp,
                    initial_inventory_base=init_base,
                    initial_inventory_quote=init_quote,
                )
            )

    oc = _as_dict(mm.get("onchain"))
    try:
        gas_gwei = int(oc.get("gas_price_gwei", 10))
    except (TypeError, ValueError):
        gas_gwei = 10
    onchain = MMOnchainConfig(
        base_token=str(oc.get("base_token", "")).strip(),
        quote_token=str(oc.get("quote_token", "")).strip(),
        gas_price_gwei=gas_gwei,
    )

    return MMSettings(
        enabled=True,
        pairs=pairs or [MMPairConfig(token_pair="BNB/USDT")],
        pricing=_as_dict(mm.get("pricing")),
        spread=_as_dict(mm.get("spread")),
        risk=_as_dict(mm.get("risk")),
        order=_as_dict(mm.get("order")),
        onchain=onchain,
    )
