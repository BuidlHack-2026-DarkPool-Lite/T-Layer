# T-LAYER — Frontend

> TEE-based Private OTC Trading Protocol on BNB Chain

T-LAYER의 프론트엔드 애플리케이션입니다. React + TypeScript + Vite로 구축되었으며, MetaMask 지갑 연결, DarkPoolEscrow 스마트 컨트랙트 연동, 백엔드 매칭 엔진 API 통신을 지원합니다.

## Tech Stack

- **React 19** + **TypeScript**
- **Vite 6** (빌드/HMR)
- **Tailwind CSS v4** (스타일링)
- **ethers.js v6** (지갑 + 컨트랙트)
- **TradingView / DexScreener** (차트 임베드)

## Architecture

```
src/
  App.tsx               # 메인 앱 (랜딩 + 트레이딩 UI)
  config.ts             # 환경변수, BSC Testnet 체인 설정, 토큰 주소
  abi.ts                # ERC20 + DarkPoolEscrow 최소 ABI
  global.d.ts           # window.ethereum 타입 선언
  hooks/
    useWallet.ts        # MetaMask 연결, 네트워크 스위칭
    useEscrow.ts        # 컨트랙트 인터랙션 (approve, deposit, cancel)
  services/
    api.ts              # REST API 클라이언트 (주문 CRUD)
    websocket.ts        # WebSocket 실시간 매칭 이벤트
```

## Features

### Wallet
- MetaMask 연결 / 해제
- BSC Testnet (Chain ID: 97) 자동 네트워크 스위칭
- 온체인 ERC20 잔고 조회

### Trading
- 9개 토큰 지원 (WBNB, ETH, BTC, SOL, XRP, CAKE, BAKE, XVS, TWT)
- BEP-20 래핑 토큰 표시
- Limit 주문 (Buy/Sell)
- 멀티 거래소 차트 (Binance, Coinbase, Bybit, OKX, DexScreener)

### Order Flow
1. **Confirm** — 주문 내용 검토 + Escrow 예치 금액 확인
2. **Approve** — ERC20 토큰 사용 승인 (MetaMask 서명)
3. **Deposit** — Escrow 컨트랙트 예치 + 백엔드 주문 생성
4. **TEE Privacy Pipeline** — 암호화 → TEE Enclave 매칭 → 서명 & 온체인 정산 시각화
5. **Success** — 체결 결과 + BSCScan 트랜잭션 링크

### Backend Integration
- `POST /order` — 주문 생성
- `GET /order/:id/status` — 주문 상태 조회
- `DELETE /order/:id` — 주문 취소
- `WS /ws` — 실시간 체결 알림 (created, matched, cancelled)

## Setup

```bash
# 의존성 설치
npm install

# 개발 서버 (localhost:3000)
npm run dev

# 빌드
npm run build
```

## Environment Variables

`.env` 파일에 아래 값을 설정합니다:

```env
# Backend Engine
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/ws

# DarkPoolEscrow Contract (BSC Testnet)
VITE_ESCROW_ADDRESS=

# Token Addresses (BSC Testnet ERC20)
VITE_TOKEN_BNB=
VITE_TOKEN_USDT=
VITE_TOKEN_ETH=
VITE_TOKEN_BTC=
VITE_TOKEN_SOL=
VITE_TOKEN_XRP=
```

## Related Repos

| Repo | Description |
|------|-------------|
| [T-Layer](https://github.com/BuidlHack-2026-DarkPool-Lite/T-Layer) | Monorepo (engine + frontend + contracts) |

## License

BuidlHack 2026
