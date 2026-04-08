# contracts-abi

DarkPool Lite 컨트랙트의 **단일 ABI 진실원**.

## 무엇

`apps/contracts/`의 Hardhat 컴파일 산출물에서 ABI만 추출한 JSON 파일들이 여기에 들어간다. engine과 frontend는 **반드시 이 디렉토리에서만** ABI를 읽는다. 다른 곳에 ABI를 수작업으로 박으면 안 된다.

## 어떻게 갱신되는가

`apps/contracts`에서 컴파일하면 자동으로 동기화된다.

```bash
cd apps/contracts
npm run compile
# → postcompile 훅이 ../../tools/sync-abi.mjs 실행
# → packages/contracts-abi/DarkPoolEscrow.json 갱신
```

수동으로도 가능:

```bash
node tools/sync-abi.mjs   # 모노레포 루트에서
```

## 파일 구조

각 JSON 파일은 다음 필드만 포함한다:

```json
{
  "contractName": "DarkPoolEscrow",
  "sourceName": "contracts/DarkPoolEscrow.sol",
  "abi": [ ... ]
}
```

bytecode는 의도적으로 제외했다 — engine/frontend는 호출만 하지 배포하지 않는다. 배포는 `apps/contracts/scripts/deploy.js`가 `artifacts/`를 직접 읽는다.

## 사용법

### engine (Python)

`packages/contracts-abi/`가 있는 가장 가까운 조상 디렉토리를 찾는 upward-search 패턴을 권장한다. 컨슈머 파일이 \`apps/engine/\` 안 어디에 있든 동작하고, 모노레포 구조 변경에도 강하다.

```python
import json
from pathlib import Path


def _find_repo_root() -> Path:
    """packages/contracts-abi 가 존재하는 가장 가까운 조상을 찾는다."""
    for ancestor in Path(__file__).resolve().parents:
        if (ancestor / "packages" / "contracts-abi").is_dir():
            return ancestor
    raise FileNotFoundError(
        "packages/contracts-abi 디렉토리를 어떤 조상에서도 찾을 수 없음"
    )


REPO_ROOT = _find_repo_root()
ABI_PATH = REPO_ROOT / "packages" / "contracts-abi" / "DarkPoolEscrow.json"
DARKPOOL_ESCROW_ABI = json.loads(ABI_PATH.read_text())["abi"]
```

\`parents[N]\` 같은 고정 깊이 인덱스는 컨슈머 파일이 이동하면 조용히 깨지므로 사용하지 않는다.

### frontend (TypeScript / Vite)

```ts
import escrow from '../../../packages/contracts-abi/DarkPoolEscrow.json';
export const DARKPOOL_ESCROW_ABI = escrow.abi;
```

> Vite에서 모노레포 외부 import를 허용하려면 `vite.config.ts`의 `server.fs.allow`에 `..`를 추가해야 할 수 있다.

## 규칙

- 이 디렉토리의 JSON 파일은 **수동으로 편집하지 않는다**. 항상 `npm run compile`로 재생성.
- 컨트랙트 인터페이스를 바꿨다면 `npm run compile`을 잊지 말고 변경된 JSON을 같이 커밋한다.
- engine `submitter.py`나 frontend `abi.ts`에 ABI 조각을 인라인으로 박는 행위 금지.
