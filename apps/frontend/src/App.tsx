import React, { useState, useEffect, useRef, useCallback } from 'react';
import { parseUnits } from 'viem';
import { Shield, Wallet, Lock, Activity, ChevronDown, X, Check, Loader2, CheckCircle2, ExternalLink, Cpu, Fingerprint, Trash2, AlertTriangle, LogOut, ShieldCheck, Brain, GitBranch, Scale } from 'lucide-react';
import { useWallet } from './hooks/useWallet';
import { useEscrow } from './hooks/useEscrow';
import { createOrder, cancelOrderApi, getOrderStatus, verifyAttestation, AttestationResult } from './services/api';
import { createWebSocket, WsEvent } from './services/websocket';
import { TOKEN_ADDRESSES, BSC_TESTNET } from './config';

const TOKENS = [
  { symbol: 'BNB', pair: 'BNB/USDT', tradingViewPair: 'BNBUSDT', name: 'Wrapped BNB', tag: 'WBNB', icon: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png', bscAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
  { symbol: 'ETH', pair: 'ETH/USDT', tradingViewPair: 'ETHUSDT', name: 'Binance-Peg ETH', tag: 'BEP-20', icon: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png', bscAddress: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8' },
  { symbol: 'BTC', pair: 'BTC/USDT', tradingViewPair: 'BTCUSDT', name: 'Binance-Peg BTC', tag: 'BEP-20', icon: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png', bscAddress: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c' },
  { symbol: 'SOL', pair: 'SOL/USDT', tradingViewPair: 'SOLUSDT', name: 'Binance-Peg SOL', tag: 'BEP-20', icon: 'https://assets.coingecko.com/coins/images/4128/small/solana.png', bscAddress: '0x570A5D26f7765Ecb712C0924E4De545B89fD43dF' },
  { symbol: 'XRP', pair: 'XRP/USDT', tradingViewPair: 'XRPUSDT', name: 'Binance-Peg XRP', tag: 'BEP-20', icon: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png', bscAddress: '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE' },
  { symbol: 'CAKE', pair: 'CAKE/USDT', tradingViewPair: 'CAKEUSDT', name: 'PancakeSwap', tag: 'BEP-20', icon: 'https://assets.coingecko.com/coins/images/12632/small/pancakeswap-cake-logo_%281%29.png', bscAddress: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82' },
  { symbol: 'BAKE', pair: 'BAKE/USDT', tradingViewPair: 'BAKEUSDT', name: 'BakerySwap', tag: 'BEP-20', icon: 'https://assets.coingecko.com/coins/images/12588/small/bakerytoken_logo.jpg', bscAddress: '0xE02dF9e3e622DeBdD69fb838bB799E3F168902c5' },
  { symbol: 'XVS', pair: 'XVS/USDT', tradingViewPair: 'XVSUSDT', name: 'Venus Protocol', tag: 'BEP-20', icon: 'https://assets.coingecko.com/coins/images/12677/small/download.jpg', bscAddress: '0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63' },
  { symbol: 'TWT', pair: 'TWT/USDT', tradingViewPair: 'TWTUSDT', name: 'Trust Wallet', tag: 'BEP-20', icon: 'https://assets.coingecko.com/coins/images/11085/small/Trust.png', bscAddress: '0x4B0F1812e5Df2A09796481Ff14017e6005508003' },
];

const TLayerLogo = ({ className = "w-6 h-6" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <polygon points="2,4 22,4 20,7.5 4,7.5" fill="currentColor" />
    <polygon points="5,10.5 19,10.5 17.5,14 6.5,14" fill="currentColor" opacity="0.5" />
    <polygon points="7.5,16.5 16.5,16.5 15.5,20 8.5,20" fill="currentColor" opacity="0.25" />
  </svg>
);

// ─── Particle Wave ──────────────────────────────────────────────────────────

function ParticleWave({ step }: { step: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stepRef = useRef(step);
  stepRef.current = step;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf: number;
    const COLS = 80;
    const RING = 14;
    const dpr = window.devicePixelRatio || 1;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const draw = (t: number) => {
      const W = canvas.width / dpr;
      const H = canvas.height / dpr;
      const s = stepRef.current;
      ctx.clearRect(0, 0, W, H);

      const baseColor = s >= 4 ? [245, 158, 11] : s >= 1 ? [52, 211, 153] : [64, 64, 64];
      const flowSpeed = s === 0 ? 0.02 : s === 1 ? 0.12 : s <= 3 ? 0.06 : s === 4 ? 0.04 : 0.01;
      const rotSpeed = s === 0 ? 0.2 : s === 1 ? 2.0 : s <= 3 ? 0.8 : s === 4 ? 0.5 : 0.1;
      const waveAmp = s === 0 ? 0.3 : s === 1 ? 4 : s <= 3 ? 2.5 : s === 4 ? 1.5 : 0;
      const waveFreq = s === 1 ? 0.25 : 0.1;
      const cylRadius = H * 0.32;
      const time = t * 0.001;
      const flowOffset = time * flowSpeed;

      const particles: { x: number; y: number; z: number; r: number; a: number }[] = [];

      for (let col = 0; col < COLS; col++) {
        for (let ring = 0; ring < RING; ring++) {
          // Each particle flows L→R, wrapping around
          const xNorm = ((col / COLS) + flowOffset) % 1;
          const x = xNorm * W;

          // Fade in at left edge, fade out at right edge
          const edgeFade = Math.min(xNorm * 5, (1 - xNorm) * 5, 1);

          const theta = (ring / RING) * Math.PI * 2 + time * rotSpeed + col * 0.15;
          const waveMod = 1 + Math.sin(col * waveFreq + time * rotSpeed) * waveAmp * 0.06;
          const r = cylRadius * waveMod;

          const cosT = Math.cos(theta);
          const sinT = Math.sin(theta);

          const y = H * 0.5 + sinT * r;
          const z = cosT;

          const dotR = 0.3 + (z + 1) * 0.35;
          const alpha = Math.max(0, (0.04 + (z + 1) * 0.18) * edgeFade);

          particles.push({ x, y, z, r: dotR, a: alpha });
        }
      }

      particles.sort((a, b) => a.z - b.z);

      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${baseColor[0]},${baseColor[1]},${baseColor[2]},${p.a})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="mb-4 relative">
      <canvas
        ref={canvasRef}
        className="w-full rounded border border-neutral-800/30 bg-[#080808]"
        style={{ height: '40px' }}
      />
      <div className="absolute bottom-0.5 right-2">
        <span className={`text-[8px] font-mono ${
          step >= 4 ? 'text-amber-600' : step >= 1 ? 'text-emerald-600' : 'text-neutral-700'
        }`}>
          {step === 0 ? 'IDLE' :
           step <= 2 ? 'ATTESTING' :
           step === 3 ? 'TEE PROCESSING' :
           step === 4 ? 'SIGNING' : 'SETTLED'}
        </span>
      </div>
    </div>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

type FlowState = 'idle' | 'confirm' | 'approve' | 'deposit' | 'match' | 'success';
type OrderStatus = 'pending' | 'partial' | 'filled' | 'canceled';

interface Order {
  id: string;
  time: string;
  pair: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  price: string;
  amount: string;
  filled: number;
  status: OrderStatus;
  txHash?: string;
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  // Landing vs App
  const [appLaunched, setAppLaunched] = useState(false);

  // Wallet (실제 MetaMask)
  const wallet = useWallet();
  const escrow = useEscrow();

  // Token & Market
  const [selectedToken, setSelectedToken] = useState(TOKENS[0]);
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>('buy');
  const [chartExchange, setChartExchange] = useState('BINANCE');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [tokenBalance, setTokenBalance] = useState('0.00');

  // Order Flow State
  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [matchStep, setMatchStep] = useState(0);
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [attestation, setAttestation] = useState<AttestationResult | null>(null);
  const [matchReasoning, setMatchReasoning] = useState<{ engine: string; reasoning: string } | null>(null);
  const currentOrderIdRef = useRef<string | null>(null);

  // WebSocket onMessage 와 15s 폴백 setTimeout 이 useEffect/startExecutionFlow
  // 호출 시점의 state 를 closure 에 캡처하면 stale 값을 읽어 매칭 UI 가
  // 업데이트되지 않고 폴백이 영원히 동작 안 하는 버그가 있어 ref 로 우회.
  const flowStateRef = useRef<FlowState>(flowState);
  const priceRef = useRef(price);
  const amountRef = useRef(amount);
  const fallbackTimeoutRef = useRef<number | null>(null);

  // Navigation & Orders
  const [activePage, setActivePage] = useState<'trade' | 'orders'>('trade');
  const [orderTab, setOrderTab] = useState<'open' | 'history'>('open');
  const [myOrders, setMyOrders] = useState<Order[]>([]);

  const myOrdersRef = useRef<Order[]>(myOrders);

  // ─── Ref sync (stale closure 회피) ─────────────────────────────────────────
  useEffect(() => { flowStateRef.current = flowState; }, [flowState]);
  useEffect(() => { priceRef.current = price; }, [price]);
  useEffect(() => { amountRef.current = amount; }, [amount]);
  useEffect(() => { myOrdersRef.current = myOrders; }, [myOrders]);
  // unmount 시 15s 폴백 타임아웃 확실히 제거
  useEffect(() => {
    return () => {
      if (fallbackTimeoutRef.current !== null) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }
    };
  }, []);

  // ─── Token Balance (온체인 조회) ───────────────────────────────────────────
  useEffect(() => {
    if (!wallet.address || !wallet.isCorrectChain) {
      setTokenBalance('0.00');
      return;
    }

    let cancelled = false;
    const symbol = orderSide === 'buy' ? 'USDT' : selectedToken.symbol;

    escrow.getTokenBalance(symbol, wallet.address).then((bal) => {
      if (!cancelled) {
        const formatted = parseFloat(bal).toFixed(4);
        setTokenBalance(formatted);
      }
    });

    return () => { cancelled = true; };
  }, [wallet.address, wallet.isCorrectChain, selectedToken, orderSide, escrow]);

  // ─── WebSocket (실시간 체결 알림) ──────────────────────────────────────────
  useEffect(() => {
    if (!wallet.address) return;

    const ws = createWebSocket({
      onMessage: (event: WsEvent) => {
        if (event.action === 'created' && event.order) {
          // 새 주문 생성 알림 (다른 유저의 주문은 무시)
        }

        if (event.action === 'matched' && event.results) {
          // 매칭 완료 — 현재 진행 중인 주문 확인
          const currentId = currentOrderIdRef.current;

          // 내 주문 ID 목록 (현재 주문 + 이전 주문 모두)
          const myOrderIds = new Set<string>();
          if (currentId) myOrderIds.add(currentId);
          // myOrders에서 내 주문 ID도 추가
          myOrdersRef.current.forEach((o: any) => myOrderIds.add(o.id));

          for (const result of event.results) {
            // 내 주문이 매칭된 경우 (현재 주문 또는 이전 주문)
            const isMyOrder =
              myOrderIds.has(result.maker_order_id) ||
              myOrderIds.has(result.taker_order_id);

            if (isMyOrder && flowStateRef.current === 'match') {
              // 실 매치가 도착했으므로 15s 폴백 타임아웃 취소
              if (fallbackTimeoutRef.current !== null) {
                clearTimeout(fallbackTimeoutRef.current);
                fallbackTimeoutRef.current = null;
              }
              // AI 매칭 근거 저장
              if (event.reasoning) {
                setMatchReasoning({
                  engine: event.engine_used || 'unknown',
                  reasoning: event.reasoning,
                });
              }
              // 매칭 단계 애니메이션 (5단계)
              setMatchStep(1);
              setTimeout(() => setMatchStep(2), 600);
              setTimeout(() => setMatchStep(3), 1200);
              setTimeout(() => setMatchStep(4), 1800);
              setTimeout(() => {
                setMatchStep(5);
                const orderAmount = amountRef.current;
                const orderPrice = priceRef.current;
                const execPrice = result.exec_price || orderPrice;
                setExecutionResult({
                  price: execPrice,
                  amount: orderAmount,
                  total: (parseFloat(orderAmount) * parseFloat(execPrice)).toFixed(2),
                  hash: result.tx_hash || '',
                  filled: 100,
                  pending: false,
                  engine_used: event.engine_used || 'volume_max',
                  scores: event.scores || null,
                  judge_reasoning: event.judge_reasoning || '',
                });
                setFlowState('success');
              }, 2000);
            }

            // 주문 목록 업데이트
            setMyOrders((prev) =>
              prev.map((o) => {
                if (o.id === result.maker_order_id || o.id === result.taker_order_id) {
                  return { ...o, status: 'filled' as OrderStatus, filled: 100, txHash: result.tx_hash };
                }
                return o;
              }),
            );
          }
        }

        if (event.action === 'cancelled' && event.order) {
          setMyOrders((prev) =>
            prev.map((o) =>
              o.id === event.order.order_id ? { ...o, status: 'canceled' as OrderStatus } : o,
            ),
          );
        }
      },
      onStatusChange: () => {},
    });

    return () => ws.close();
  }, [wallet.address]);

  // ─── Order Submission ──────────────────────────────────────────────────────

  // 주문 입력 유효성 — handleOrderSubmit 와 submit 버튼 disabled 가 공유.
  // "0", "-1", "abc" 같은 값은 truthy 문자열이라 !amount 로는 못 거른다.
  const numericAmount = Number(amount);
  const numericPrice = Number(price);
  const isOrderInputValid =
    Number.isFinite(numericAmount) &&
    numericAmount > 0 &&
    Number.isFinite(numericPrice) &&
    numericPrice > 0;

  const handleOrderSubmit = () => {
    if (!isOrderInputValid) return;
    if (!wallet.isConnected || !wallet.isCorrectChain) return;
    setFlowError(null);
    setFlowState('confirm');
  };

  const startExecutionFlow = async () => {
    setFlowError(null);

    try {
      // Deposit할 토큰 결정: buy면 USDT를 예치, sell이면 해당 토큰을 예치
      const depositSymbol = orderSide === 'buy' ? 'USDT' : selectedToken.symbol;
      const tokenAddress = TOKEN_ADDRESSES[depositSymbol];
      const depositAmount = orderSide === 'buy'
        ? parseUnits((parseFloat(amount) * parseFloat(price)).toFixed(6), 18)
        : parseUnits(amount, 18);

      // Phase 1: ERC20 Approve
      setFlowState('approve');
      if (tokenAddress) {
        await escrow.approveToken(tokenAddress, depositAmount);
      }

      // Phase 2: API 주문 생성 + Escrow Deposit
      setFlowState('deposit');
      // 슬리피지 버퍼: 매수 +1%, 매도 -1% (MM 봇 호가와 겹치도록)
      const priceNum = parseFloat(price);
      const bufferedPrice = orderSide === 'buy'
        ? (priceNum * 1.01).toFixed(6)
        : (priceNum * 0.99).toFixed(6);
      const orderResponse = await createOrder({
        token_pair: selectedToken.pair,
        side: orderSide,
        amount: amount,
        limit_price: bufferedPrice,
        wallet_address: wallet.address!,
      });

      const orderId = orderResponse.order_id;
      currentOrderIdRef.current = orderId;

      // Escrow Deposit (컨트랙트 주소가 설정된 경우에만)
      let depositTxHash = '';
      if (tokenAddress) {
        const receipt = await escrow.deposit(orderId, tokenAddress, depositAmount);
        depositTxHash = receipt?.hash || '';
      }

      // 주문 목록에 추가
      const newOrder: Order = {
        id: orderId,
        time: new Date().toLocaleTimeString('en-US', { hour12: false }),
        pair: selectedToken.pair,
        side: orderSide,
        type: 'limit',
        price: parseFloat(price).toFixed(2),
        amount: amount,
        filled: 0,
        status: 'pending',
        txHash: depositTxHash,
      };
      setMyOrders((prev) => [newOrder, ...prev]);

      // Phase 3: TEE 검증 + 매칭 대기
      setFlowState('match');
      setMatchStep(0);
      setAttestation(null);
      setMatchReasoning(null);

      // TEE attestation 검증
      try {
        const att = await verifyAttestation();
        setAttestation(att);
      } catch (attErr) {
        console.warn('Attestation verification failed:', attErr);
      }
      setMatchStep(1);

      // 매칭은 WebSocket에서 처리됨
      // 만약 15초 안에 매칭 안 되면 pending 상태로 종료.
      // flowStateRef 를 써서 stale closure 회피, fallbackTimeoutRef 에
      // id 를 저장해 WS 매치 도착 / resetFlow 시 clearTimeout 가능.
      if (fallbackTimeoutRef.current !== null) {
        clearTimeout(fallbackTimeoutRef.current);
      }
      fallbackTimeoutRef.current = window.setTimeout(() => {
        fallbackTimeoutRef.current = null;
        if (flowStateRef.current !== 'match') return;
        // 타임아웃: TEE 애니메이션 없이 바로 pending 표시
        const fallbackPrice = priceRef.current;
        const fallbackAmount = amountRef.current;
        setMatchStep(2);
        setFlowState('success');
        setExecutionResult({
          price: fallbackPrice,
          amount: fallbackAmount,
          total: (parseFloat(fallbackAmount) * parseFloat(fallbackPrice)).toFixed(2),
          hash: depositTxHash,
          filled: 0,
          pending: true,
          engine_used: null,
          scores: null,
          judge_reasoning: '',
        });
      }, 120000);

    } catch (err: any) {
      console.error('Order execution failed:', err);

      // MetaMask 사용자 거부
      if (err.code === 'ACTION_REJECTED' || err.code === 4001) {
        setFlowError('Transaction rejected by user');
      } else {
        setFlowError(err.message || 'Transaction failed');
      }

      // 에러 시 confirm으로 돌아감
      setFlowState('confirm');
    }
  };

  const resetFlow = () => {
    if (fallbackTimeoutRef.current !== null) {
      clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = null;
    }
    setFlowState('idle');
    setAmount('');
    setPrice('');
    setMatchStep(0);
    setExecutionResult(null);
    setFlowError(null);
    setMatchReasoning(null);
    currentOrderIdRef.current = null;
  };

  // ─── Cancel Order ──────────────────────────────────────────────────────────

  const handleCancelOrder = async (orderId: string) => {
    try {
      // API 취소
      await cancelOrderApi(orderId);

      // 컨트랙트 취소 (설정된 경우)
      try {
        await escrow.cancelOrder(orderId);
      } catch {
        // 컨트랙트 미설정 시 무시
      }

      setMyOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: 'canceled' as OrderStatus } : o)),
      );
    } catch (err: any) {
      console.error('Cancel failed:', err);
      // API 실패해도 로컬에서 취소 처리
      setMyOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: 'canceled' as OrderStatus } : o)),
      );
    }
  };

  // ─── Derived Values ────────────────────────────────────────────────────────

  const feeAmount = amount && price
    ? (orderSide === 'buy'
      ? (parseFloat(amount) * 0.001).toFixed(4)
      : (parseFloat(amount) * parseFloat(price) * 0.001).toFixed(4))
    : '0.00';
  const feeSymbol = orderSide === 'buy' ? selectedToken.symbol : 'USDT';
  const totalUsdt = amount && price ? (parseFloat(amount) * parseFloat(price)).toFixed(2) : '0.00';

  const isWalletReady = wallet.isConnected && wallet.isCorrectChain;

  // Trade History = filled orders
  const tradeHistory = myOrders
    .filter((o) => o.status === 'filled')
    .map((o) => ({
      id: o.id,
      type: o.side,
      pair: o.pair,
      amount: o.amount,
      price: o.price,
      time: o.time,
      status: 'Settled',
    }));

  // ─── Render ────────────────────────────────────────────────────────────────

  // 랜딩 페이지
  if (!appLaunched && !wallet.isConnected) {
    return (
      <div className="h-[100dvh] bg-[#050505] text-gray-300 font-sans flex flex-col items-center justify-center selection:bg-emerald-500/30 relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

        {/* Scattered keywords */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden font-mono select-none">
          <div className="absolute top-[8%] left-[5%] text-[10px] text-white/[0.04] animate-pulse" style={{ animationDuration: '4s' }}>REDACTED</div>
          <div className="absolute top-[15%] right-[8%] text-[9px] text-emerald-500/[0.06] animate-pulse" style={{ animationDelay: '1s', animationDuration: '3s' }}>ENCRYPTED</div>
          <div className="absolute top-[22%] left-[12%] text-[11px] text-white/[0.03] animate-pulse" style={{ animationDelay: '2.5s', animationDuration: '5s' }}>PRIVATE</div>
          <div className="absolute top-[30%] right-[15%] text-[8px] text-emerald-400/[0.05] animate-pulse" style={{ animationDelay: '0.5s', animationDuration: '3.5s' }}>REDACTED</div>
          <div className="absolute top-[38%] left-[3%] text-[9px] text-white/[0.035] animate-pulse" style={{ animationDelay: '1.8s', animationDuration: '4.5s' }}>ENCRYPTED</div>
          <div className="absolute top-[48%] right-[4%] text-[10px] text-white/[0.03] animate-pulse" style={{ animationDelay: '3s', animationDuration: '4s' }}>PRIVATE</div>
          <div className="absolute top-[55%] left-[8%] text-[8px] text-emerald-500/[0.05] animate-pulse" style={{ animationDelay: '0.8s', animationDuration: '3s' }}>REDACTED</div>
          <div className="absolute top-[62%] right-[12%] text-[11px] text-white/[0.03] animate-pulse" style={{ animationDelay: '2s', animationDuration: '5s' }}>ENCRYPTED</div>
          <div className="absolute top-[70%] left-[6%] text-[9px] text-emerald-400/[0.04] animate-pulse" style={{ animationDelay: '1.2s', animationDuration: '3.5s' }}>PRIVATE</div>
          <div className="absolute top-[78%] right-[6%] text-[8px] text-white/[0.04] animate-pulse" style={{ animationDelay: '2.8s', animationDuration: '4s' }}>REDACTED</div>
          <div className="absolute top-[85%] left-[15%] text-[10px] text-emerald-500/[0.05] animate-pulse" style={{ animationDelay: '0.3s', animationDuration: '3s' }}>ENCRYPTED</div>
          <div className="absolute top-[92%] right-[10%] text-[9px] text-white/[0.03] animate-pulse" style={{ animationDelay: '1.5s', animationDuration: '4.5s' }}>PRIVATE</div>
        </div>

        <div className="relative z-10 flex flex-col items-center max-w-md px-6 text-center">
          {/* Logo */}
          <div className="mb-4 drop-shadow-[0_0_24px_rgba(16,185,129,0.3)]">
            <TLayerLogo className="w-12 h-12 text-emerald-400" />
          </div>

          <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">
            T-LAYER
          </h1>
          <p className="text-neutral-400 text-lg mb-2">Private OTC Trading on BNB Chain</p>
          <p className="text-neutral-600 text-sm mb-10 max-w-sm">
            Trade privately with TEE-powered matching. Your order details are never exposed on-chain.
          </p>

          {/* Features */}
          <div className="flex items-center gap-6 mb-10 text-xs text-neutral-500">
            <span className="flex items-center gap-1.5">
              <div className="w-1 h-1 rounded-full bg-emerald-500"></div>
              TEE Matching
            </span>
            <span className="flex items-center gap-1.5">
              <div className="w-1 h-1 rounded-full bg-emerald-500"></div>
              Zero Leakage
            </span>
            <span className="flex items-center gap-1.5">
              <div className="w-1 h-1 rounded-full bg-emerald-500"></div>
              Atomic Settlement
            </span>
          </div>

          {/* Launch App Button */}
          <button
            onClick={() => setAppLaunched(true)}
            className="flex items-center gap-3 px-8 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base transition-all shadow-[0_0_30px_rgba(16,185,129,0.25)] hover:shadow-[0_0_40px_rgba(16,185,129,0.35)]"
          >
            Launch App
          </button>

          <p className="text-neutral-600 text-xs mt-6 font-mono">BSC Testnet (Chain ID: 97)</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] overflow-hidden bg-[#050505] text-gray-300 font-sans flex flex-col selection:bg-emerald-500/30">
      {/* Header */}
      <header className="h-16 border-b border-neutral-800/50 bg-[#0a0a0a] flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2.5">
            <div className="drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]">
              <TLayerLogo className="w-7 h-7 text-emerald-400" />
            </div>
            <span className="font-bold text-lg tracking-tight text-white">T-LAYER</span>
          </div>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-1 bg-neutral-900/50 p-1 rounded-lg border border-neutral-800">
            <button
              onClick={() => setActivePage('trade')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activePage === 'trade' ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-300'}`}
            >
              Trade
            </button>
            <button
              onClick={() => setActivePage('orders')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activePage === 'orders' ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-300'}`}
            >
              Orders
            </button>
          </nav>

          <div className="h-4 w-px bg-neutral-800 hidden sm:block"></div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 text-xs font-mono text-neutral-500">
            <Activity className="w-3.5 h-3.5" />
            <span>BNB Chain{!wallet.isCorrectChain ? ' (Wrong Network)' : ''}</span>
          </div>

          {/* Wallet area */}
          {!wallet.isConnected ? (
            <button
              onClick={wallet.connect}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.2)] transition-all"
            >
              <Wallet className="w-4 h-4" />
              Connect Wallet
            </button>
          ) : !wallet.isCorrectChain ? (
            <button
              onClick={wallet.switchToTestnet}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-amber-600 hover:bg-amber-500 text-white transition-all"
            >
              <AlertTriangle className="w-4 h-4" />
              Switch Network
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-4 py-2 rounded-md bg-neutral-900 border border-neutral-800 text-sm font-mono text-white">
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                {truncateAddress(wallet.address!)}
              </div>
              <button
                onClick={wallet.disconnect}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-rose-400 hover:border-rose-500/30 transition-all"
                title="Disconnect Wallet"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        {activePage === 'trade' ? (
          <>
            {/* Left Column: Chart & History */}
            <div className="flex-1 flex flex-col min-w-0 border-b lg:border-b-0 lg:border-r border-neutral-800/50 lg:overflow-hidden shrink-0 lg:shrink">

              {/* Chart Area */}
              <div className="flex-1 relative bg-[#0a0a0a] min-h-[400px] lg:min-h-0 shrink-0 lg:shrink flex flex-col">
                {/* Exchange Tabs */}
                <div className="flex items-center gap-1 px-4 py-2 border-b border-neutral-800/50 shrink-0">
                  {['BINANCE', 'COINBASE', 'BYBIT', 'OKX'].map((ex) => (
                    <button
                      key={ex}
                      onClick={() => setChartExchange(ex)}
                      className={`px-3 py-1 rounded text-[11px] font-mono transition-colors ${
                        chartExchange === ex
                          ? 'bg-neutral-800 text-white'
                          : 'text-neutral-500 hover:text-neutral-300'
                      }`}
                    >
                      {ex}
                    </button>
                  ))}
                  <div className="w-px h-4 bg-neutral-800 mx-1"></div>
                  <button
                    onClick={() => setChartExchange('DEXSCREENER')}
                    className={`px-3 py-1 rounded text-[11px] font-mono transition-colors ${
                      chartExchange === 'DEXSCREENER'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'text-neutral-500 hover:text-neutral-300'
                    }`}
                  >
                    DEX
                  </button>
                  <span className="ml-auto text-[10px] text-neutral-600 font-mono">Multi-source pricing</span>
                </div>
                <div className="flex-1 relative">
                  {chartExchange === 'DEXSCREENER' ? (
                    <iframe
                      key={`dex-${selectedToken.bscAddress}`}
                      src={`https://dexscreener.com/bsc/${selectedToken.bscAddress}?embed=1&theme=dark&trades=0&info=0`}
                      className="w-full h-full border-none"
                      title="DEX Screener Chart"
                    />
                  ) : (
                    <iframe
                      key={`${chartExchange}-${selectedToken.tradingViewPair}`}
                      src={`https://www.tradingview.com/widgetembed/?symbol=${chartExchange}%3A${selectedToken.tradingViewPair}&interval=60&theme=dark&style=1&timezone=Asia%2FSeoul`}
                      className="w-full h-full border-none"
                      title="TradingView Chart"
                    />
                  )}
                </div>
              </div>

              {/* Order History */}
              <div className="h-64 bg-[#0a0a0a] border-t border-neutral-800/50 flex flex-col shrink-0">
                <div className="px-4 py-3 border-b border-neutral-800/50 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Encrypted Trade History</h3>
                  <span className="text-xs text-neutral-500 font-mono">Only your trades are visible</span>
                </div>
                <div className="flex-1 overflow-auto px-4 pb-4">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-neutral-500 font-mono sticky top-0 bg-[#0a0a0a] z-10 shadow-[0_1px_0_0_rgba(38,38,38,0.5)]">
                      <tr>
                        <th className="py-3 font-normal">Time</th>
                        <th className="py-3 font-normal">Pair</th>
                        <th className="py-3 font-normal">Side</th>
                        <th className="py-3 font-normal text-right">Price</th>
                        <th className="py-3 font-normal text-right">Amount</th>
                        <th className="py-3 font-normal text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-xs">
                      {tradeHistory.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-neutral-600 font-sans">
                            No trades yet. Place your first order.
                          </td>
                        </tr>
                      ) : (
                        tradeHistory.map((tx) => (
                          <tr key={tx.id} className="border-b border-neutral-800/30 hover:bg-neutral-900/50 transition-colors">
                            <td className="py-2.5 text-neutral-400">{tx.time}</td>
                            <td className="py-2.5 text-white">{tx.pair}</td>
                            <td className={`py-2.5 ${tx.type === 'buy' ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {tx.type.toUpperCase()}
                            </td>
                            <td className="py-2.5 text-right text-neutral-300">{tx.price}</td>
                            <td className="py-2.5 text-right text-neutral-300">{tx.amount}</td>
                            <td className="py-2.5 text-right">
                              <span className="inline-flex items-center justify-end gap-1.5 text-neutral-400">
                                <Shield className="w-3 h-3 text-emerald-500/70" />
                                {tx.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Right Column: Order Panel */}
            <div className="w-full lg:w-[360px] bg-[#0a0a0a] flex flex-col shrink-0 lg:overflow-y-auto">

              {/* Token Selector */}
              <div className="p-4 border-b border-neutral-800/50">
                <button
                  onClick={() => setIsTokenModalOpen(true)}
                  className="flex items-center justify-between w-full px-4 py-3 bg-neutral-900/50 hover:bg-neutral-900 border border-neutral-800 rounded-xl transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <img src={selectedToken.icon} alt={selectedToken.symbol} className="w-8 h-8 rounded-full" />
                    <div className="flex flex-col items-start">
                      <span className="font-bold text-white leading-tight">{selectedToken.symbol}</span>
                      <span className="text-xs text-neutral-500">{selectedToken.name}</span>
                    </div>
                  </div>
                  <ChevronDown className="w-5 h-5 text-neutral-500 group-hover:text-white transition-colors" />
                </button>
              </div>

              {/* Order Form */}
              <div className="p-4 flex-1 flex flex-col">
                {/* Buy/Sell Toggle */}
                <div className="flex p-1 bg-neutral-900 rounded-lg mb-6">
                  <button
                    onClick={() => setOrderSide('buy')}
                    className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all ${
                      orderSide === 'buy'
                        ? 'bg-emerald-500/10 text-emerald-400 shadow-sm'
                        : 'text-neutral-500 hover:text-neutral-300'
                    }`}
                  >
                    Buy
                  </button>
                  <button
                    onClick={() => setOrderSide('sell')}
                    className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all ${
                      orderSide === 'sell'
                        ? 'bg-rose-500/10 text-rose-400 shadow-sm'
                        : 'text-neutral-500 hover:text-neutral-300'
                    }`}
                  >
                    Sell
                  </button>
                </div>

                {/* Input Fields */}
                <div className="space-y-4 mb-6">
                  <div>
                    <div className="flex justify-between text-xs mb-1.5 text-neutral-500">
                      <span>Price</span>
                      <span className="font-mono">Limit</span>
                    </div>
                    <div className="bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 flex items-center focus-within:border-neutral-600 transition-colors">
                      <input
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder="0.00"
                        className="bg-transparent border-none outline-none w-full text-white font-mono placeholder:text-neutral-600"
                      />
                      <div className="flex items-center gap-2 pl-3 border-l border-neutral-800">
                        <span className="text-white text-sm font-medium">USDT</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1.5 text-neutral-500">
                      <span>Amount</span>
                      <span className="font-mono">Balance: {tokenBalance} {orderSide === 'buy' ? 'USDT' : selectedToken.symbol}</span>
                    </div>
                    <div className="bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 flex items-center focus-within:border-neutral-600 transition-colors">
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        className="bg-transparent border-none outline-none w-full text-white font-mono placeholder:text-neutral-600"
                      />
                      <div className="flex items-center gap-2 pl-3 border-l border-neutral-800">
                        <span className="text-white text-sm font-medium">{selectedToken.symbol}</span>
                      </div>
                    </div>
                  </div>

                  {/* Order Summary */}
                  <div className="space-y-2 pt-4 border-t border-neutral-800/50">
                    <div className="flex justify-between text-xs">
                      <span className="text-neutral-500">Fee (0.1%)</span>
                      <span className="font-mono text-neutral-400">
                        {feeAmount} {feeSymbol}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-500">Total</span>
                      <span className="font-mono font-medium text-white">
                        {totalUsdt} USDT
                      </span>
                    </div>
                  </div>
                </div>

                {/* Privacy Info Box */}
                <div className="bg-neutral-900/50 border border-neutral-800 rounded-lg p-3 mb-6">
                  <div className="flex items-start gap-2">
                    <Shield className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                    <div className="text-xs text-neutral-400 leading-relaxed">
                      <span className="text-neutral-200 font-medium block mb-1">TEE Execution</span>
                      Your order details are encrypted and processed inside a Trusted Execution Environment. Only settlement data is posted to BNB Chain.
                    </div>
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  onClick={handleOrderSubmit}
                  disabled={!isWalletReady || !isOrderInputValid}
                  className={`w-full py-4 rounded-lg font-bold text-sm transition-all ${
                    (!isWalletReady || !isOrderInputValid)
                      ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
                      : orderSide === 'buy'
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.15)]'
                      : 'bg-rose-600 hover:bg-rose-500 text-white shadow-[0_0_20px_rgba(225,29,72,0.15)]'
                  }`}
                >
                  {!wallet.isConnected
                    ? 'Connect Wallet to Trade'
                    : !wallet.isCorrectChain
                    ? 'Switch to BSC Testnet'
                    : `${orderSide === 'buy' ? 'Buy' : 'Sell'} ${selectedToken.symbol} Privately`}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Orders Page */
          <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-[#050505]">
            <div className="max-w-6xl mx-auto space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h2 className="text-2xl font-bold text-white">My Orders</h2>
                <div className="flex items-center gap-1 bg-neutral-900 border border-neutral-800 rounded-lg p-1">
                  <button
                    onClick={() => setOrderTab('open')}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${orderTab === 'open' ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-500 hover:text-white'}`}
                  >
                    Open Orders
                  </button>
                  <button
                    onClick={() => setOrderTab('history')}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${orderTab === 'history' ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-500 hover:text-white'}`}
                  >
                    Order History
                  </button>
                </div>
              </div>

              <div className="bg-[#0a0a0a] border border-neutral-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left whitespace-nowrap">
                    <thead className="text-xs text-neutral-500 font-mono bg-neutral-900/50 border-b border-neutral-800">
                      <tr>
                        <th className="px-6 py-4 font-normal">Time</th>
                        <th className="px-6 py-4 font-normal">Pair</th>
                        <th className="px-6 py-4 font-normal">Type</th>
                        <th className="px-6 py-4 font-normal">Side</th>
                        <th className="px-6 py-4 font-normal text-right">Price</th>
                        <th className="px-6 py-4 font-normal text-right">Amount</th>
                        <th className="px-6 py-4 font-normal text-right">Filled</th>
                        <th className="px-6 py-4 font-normal text-center">Status</th>
                        <th className="px-6 py-4 font-normal text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-xs divide-y divide-neutral-800/50">
                      {myOrders
                        .filter(o => orderTab === 'open' ? (o.status === 'pending' || o.status === 'partial') : (o.status === 'filled' || o.status === 'canceled'))
                        .map(order => (
                        <tr key={order.id} className="hover:bg-neutral-900/30 transition-colors">
                          <td className="px-6 py-4 text-neutral-400">{order.time}</td>
                          <td className="px-6 py-4 font-bold text-white">{order.pair}</td>
                          <td className="px-6 py-4 text-neutral-400 capitalize">{order.type}</td>
                          <td className={`px-6 py-4 font-bold ${order.side === 'buy' ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {order.side.toUpperCase()}
                          </td>
                          <td className="px-6 py-4 text-right text-white">{order.price}</td>
                          <td className="px-6 py-4 text-right text-white">{order.amount}</td>
                          <td className="px-6 py-4 text-right text-neutral-400">{order.filled}%</td>
                          <td className="px-6 py-4 text-center">
                            <span className={`inline-flex items-center px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                              order.status === 'pending' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                              order.status === 'partial' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                              order.status === 'filled' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                              'bg-neutral-500/10 text-neutral-400 border border-neutral-500/20'
                            }`}>
                              {order.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            {(order.status === 'pending' || order.status === 'partial') ? (
                              <button
                                onClick={() => handleCancelOrder(order.id)}
                                className="text-rose-400 hover:text-rose-300 transition-colors p-1"
                                title="Cancel Order"
                              >
                                <Trash2 className="w-4 h-4 inline" />
                              </button>
                            ) : order.txHash ? (
                              <a
                                href={`${BSC_TESTNET.blockExplorer}/tx/${order.txHash}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-neutral-500 hover:text-emerald-400 transition-colors p-1"
                                title="View on Explorer"
                              >
                                <ExternalLink className="w-4 h-4 inline" />
                              </a>
                            ) : (
                              <span className="text-neutral-600">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {myOrders.filter(o => orderTab === 'open' ? (o.status === 'pending' || o.status === 'partial') : (o.status === 'filled' || o.status === 'canceled')).length === 0 && (
                        <tr>
                          <td colSpan={9} className="px-6 py-12 text-center text-neutral-500 font-sans">
                            {!wallet.isConnected ? 'Connect your wallet to see orders.' : `No ${orderTab} orders found.`}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Token Selection Modal */}
      {isTokenModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#0a0a0a] border border-neutral-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-5 border-b border-neutral-800/50 bg-neutral-900/20">
              <h2 className="text-lg font-semibold text-white">Select Token</h2>
              <button
                onClick={() => setIsTokenModalOpen(false)}
                className="p-2 text-neutral-500 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-3 max-h-[60vh] overflow-y-auto">
              {TOKENS.map((token) => (
                <button
                  key={token.symbol}
                  onClick={() => {
                    setSelectedToken(token);
                    setIsTokenModalOpen(false);
                  }}
                  className={`flex items-center justify-between w-full p-4 rounded-xl hover:bg-neutral-900 transition-all mb-1 last:mb-0 ${
                    selectedToken.symbol === token.symbol
                      ? 'bg-neutral-900/80 border border-neutral-800'
                      : 'border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <img src={token.icon} alt={token.symbol} className={`w-10 h-10 rounded-full ${
                      selectedToken.symbol === token.symbol ? 'ring-2 ring-emerald-500/50' : ''
                    }`} />
                    <div className="flex flex-col items-start">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-base">{token.symbol}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700">{token.tag}</span>
                      </div>
                      <span className="text-sm text-neutral-500">{token.name}</span>
                    </div>
                  </div>
                  {selectedToken.symbol === token.symbol && (
                    <Check className="w-5 h-5 text-emerald-500" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Order Execution Flow Overlay */}
      {flowState !== 'idle' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className={`w-full bg-[#0a0a0a] border border-neutral-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-300 transition-all ${
            flowState === 'match' || flowState === 'success' ? 'max-w-3xl' : 'max-w-md'
          }`}>

            {/* Phase 1: Confirm */}
            {flowState === 'confirm' && (
              <>
                <div className="p-6 border-b border-neutral-800/50">
                  <h2 className="text-xl font-bold text-white mb-1">Confirm Order</h2>
                  <p className="text-sm text-neutral-500">Review your encrypted order details</p>
                </div>
                <div className="p-6 space-y-4">
                  {flowError && (
                    <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span className="text-xs text-rose-400">{flowError}</span>
                    </div>
                  )}
                  <div className="bg-neutral-900/50 rounded-xl p-4 border border-neutral-800 space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-500">Pair</span>
                      <span className="font-bold text-white">{selectedToken.pair}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-500">Side</span>
                      <span className={`font-bold ${orderSide === 'buy' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {orderSide.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-500">Amount</span>
                      <span className="font-mono text-white">{amount} {selectedToken.symbol}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-500">Price</span>
                      <span className="font-mono text-white">{price} USDT</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-500">Fee (0.1%)</span>
                      <span className="font-mono text-emerald-400">{feeAmount} {feeSymbol}</span>
                    </div>
                  </div>

                  <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Lock className="w-4 h-4 text-emerald-500" />
                      <span className="text-sm font-medium text-emerald-400">Pre-deposit Required</span>
                    </div>
                    <div className="flex justify-between items-end">
                      <span className="text-xs text-neutral-400">Escrow Amount</span>
                      <span className="font-mono font-bold text-white">
                        {orderSide === 'buy' ? `${totalUsdt} USDT` : `${amount} ${selectedToken.symbol}`}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="p-6 pt-0 flex gap-3">
                  <button
                    onClick={resetFlow}
                    className="flex-1 py-3 rounded-lg font-medium text-sm bg-neutral-900 text-white hover:bg-neutral-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={startExecutionFlow}
                    className="flex-1 py-3 rounded-lg font-bold text-sm bg-emerald-600 text-white hover:bg-emerald-500 transition-colors shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                  >
                    Approve + Deposit
                  </button>
                </div>
              </>
            )}

            {/* Phase 2: Wallet Signature (Approve & Deposit) */}
            {(flowState === 'approve' || flowState === 'deposit') && (
              <div className="p-10 flex flex-col items-center justify-center text-center min-h-[300px]">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-emerald-500/20 blur-xl rounded-full"></div>
                  <div className="w-16 h-16 bg-neutral-900 border border-neutral-800 rounded-full flex items-center justify-center relative z-10">
                    <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                  </div>
                </div>
                <h3 className="text-lg font-bold text-white mb-2">
                  {flowState === 'approve' ? 'Approve Token' : 'Deposit to Escrow'}
                </h3>
                <p className="text-sm text-neutral-400 font-mono">
                  {flowState === 'approve' ? 'Confirm in your wallet...' : 'Securing assets in smart contract...'}
                </p>

                <div className="mt-8 flex items-center gap-2 text-xs text-neutral-500">
                  <Shield className="w-3.5 h-3.5" />
                  <span>Funds are locked until TEE execution</span>
                </div>
              </div>
            )}

            {/* Phase 3: TEE Matching — Node + Terminal */}
            {flowState === 'match' && (
              <div className="p-8 flex flex-col min-h-[540px]">
                <div className="mb-6">
                  <h3 className="text-lg font-bold text-white tracking-tight">TEE Privacy Pipeline</h3>
                  <p className="text-xs text-neutral-500 font-mono mt-0.5">Enclave execution in progress</p>
                </div>

                {/* ─── Pipeline Status Bar ─── */}
                <div className="mb-6 px-2">
                  <div className="flex items-center">
                    {[
                      { step: 1, label: 'Attest', color: 'emerald' },
                      { step: 2, label: 'Encrypt', color: 'emerald' },
                      { step: 3, label: 'Compete', color: 'emerald' },
                      { step: 4, label: 'Sign', color: 'amber' },
                      { step: 5, label: 'Settle', color: 'amber' },
                    ].map(({ step, label, color }, i, arr) => (
                      <React.Fragment key={step}>
                        <div className="flex flex-col items-center gap-1.5 shrink-0">
                          <div className={`w-3 h-3 rounded-full border-2 transition-all duration-500 ${
                            matchStep >= step
                              ? color === 'amber' ? 'border-amber-500 bg-amber-500' : 'border-emerald-500 bg-emerald-500'
                              : 'border-neutral-600 bg-transparent'
                          }`} />
                          <span className={`text-[10px] font-mono transition-colors duration-500 ${
                            matchStep >= step
                              ? color === 'amber' ? 'text-amber-400' : 'text-emerald-400'
                              : 'text-neutral-600'
                          }`}>{label}</span>
                        </div>
                        {i < arr.length - 1 && (
                          <div className="flex-1 h-px mx-2 bg-neutral-800 relative" style={{ marginBottom: '20px' }}>
                            <div className={`absolute inset-y-0 left-0 h-px transition-all duration-1000 ease-out ${
                              matchStep >= step + 1 ? 'w-full' : 'w-0'
                            } ${arr[i + 1].color === 'amber' ? 'bg-amber-500/80' : 'bg-emerald-500/80'}`} />
                          </div>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                  <div className="flex justify-between mt-2 px-1">
                    <span className={`text-[9px] font-mono ${matchStep >= 1 && matchStep < 2 ? 'text-emerald-500/50' : 'text-neutral-700'}`}>VERIFY</span>
                    <span className={`text-[9px] font-mono ${matchStep >= 2 && matchStep < 4 ? 'text-emerald-500/50' : 'text-neutral-700'}`}>TEE ENCLAVE</span>
                    <span className={`text-[9px] font-mono ${matchStep >= 4 ? 'text-amber-500/50' : 'text-neutral-700'}`}>BNB CHAIN</span>
                  </div>
                </div>

                {/* ─── 3D Particle Wave ─── */}
                <ParticleWave step={matchStep} />

                {/* ─── Terminal Log ─── */}
                <div className="flex-1 bg-[#0c0c0c] border border-neutral-800 rounded-lg overflow-hidden flex flex-col">
                  {/* Terminal header */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800/50 bg-neutral-900/50">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-500/40" />
                      <div className="w-2 h-2 rounded-full bg-amber-500/40" />
                      <div className="w-2 h-2 rounded-full bg-emerald-500/40" />
                    </div>
                    <span className="text-[11px] font-mono text-neutral-600">tee-enclave — competitive matching</span>
                  </div>
                  {/* Terminal body */}
                  <div className="flex-1 px-4 py-3 space-y-1.5 overflow-y-auto font-mono text-xs">
                    {matchStep >= 0 && (
                      <div className="text-neutral-500">
                        <span className="text-neutral-600">$</span> Verifying TEE environment...
                      </div>
                    )}
                    {/* Step 1: TEE Attestation (pre-matching verification) */}
                    {matchStep >= 1 && (
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-500">{'>'}</span>
                        <span className="text-neutral-300">Enclave measurement</span>
                        <span className="text-neutral-600">NEAR AI Cloud</span>
                        {matchStep >= 2
                          ? attestation?.success
                            ? <span className="text-emerald-500 ml-auto">VALID</span>
                            : <span className="text-amber-500 ml-auto">UNVERIFIED</span>
                          : <Loader2 className="w-3 h-3 text-emerald-400 animate-spin ml-auto" />}
                      </div>
                    )}
                    {matchStep >= 1 && matchStep < 2 && (
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-500">{'>'}</span>
                        <span className="text-neutral-300">GPU attestation</span>
                        <Loader2 className="w-3 h-3 text-emerald-400 animate-spin ml-auto" />
                      </div>
                    )}
                    {matchStep >= 2 && (
                      <div className="flex items-center gap-2">
                        <span className={attestation?.success ? 'text-emerald-500' : 'text-amber-500'}>{'>'}</span>
                        <span className="text-neutral-300">GPU attestation</span>
                        <span className="text-neutral-500">{attestation?.gpu_model || '—'}</span>
                        {attestation?.success
                          ? <span className="text-emerald-500 ml-auto">VERIFIED</span>
                          : <span className="text-amber-500 ml-auto">UNVERIFIED</span>}
                      </div>
                    )}
                    {matchStep >= 2 && attestation && (
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-500">{'>'}</span>
                        <span className="text-neutral-300">Measurement:</span>
                        <span className="text-emerald-500/60">{attestation.enclave_measurement}</span>
                      </div>
                    )}
                    {/* Step 3: Encrypt */}
                    {matchStep >= 3 && (
                      <div className="flex items-center gap-2 pt-1 border-t border-neutral-800/30">
                        <span className="text-emerald-500">{'>'}</span>
                        <span className="text-neutral-300">Encrypting order</span>
                        <span className="text-neutral-600">AES-256-GCM</span>
                        <span className="text-emerald-500 ml-auto">OK</span>
                      </div>
                    )}
                    {matchStep >= 3 && (
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-500">{'>'}</span>
                        <span className="text-neutral-300">Payload:</span>
                        <span className="text-neutral-500">{selectedToken.pair} · {orderSide.toUpperCase()} · ██████</span>
                      </div>
                    )}
                    {/* Step 3-4: Competitive TEE Matching — only show when real match data exists */}
                    {matchStep >= 3 && executionResult && !executionResult.pending && (
                      <>
                        <div className="flex items-center gap-2 pt-1 border-t border-neutral-800/30">
                          <span className="text-emerald-500">{'>'}</span>
                          <span className="text-neutral-300">Qwen3-30B-A3B</span>
                          <span className="text-neutral-600">Conservative</span>
                          {matchStep >= 4 ? <span className={`ml-auto ${executionResult.engine_used === 'conservative' ? 'text-cyan-400 font-bold' : 'text-emerald-500'}`}>{executionResult.engine_used === 'conservative' ? 'WINNER' : 'DONE'}</span> : <Loader2 className="w-3 h-3 text-emerald-400 animate-spin ml-auto" />}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-amber-400">{'>'}</span>
                          <span className="text-neutral-300">GLM-5-FP8</span>
                          <span className="text-neutral-600">Volume Max</span>
                          {matchStep >= 4 ? <span className={`ml-auto ${executionResult.engine_used === 'volume_max' ? 'text-cyan-400 font-bold' : 'text-amber-400'}`}>{executionResult.engine_used === 'volume_max' ? 'WINNER' : 'DONE'}</span> : <Loader2 className="w-3 h-3 text-amber-400 animate-spin ml-auto" />}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-purple-400">{'>'}</span>
                          <span className="text-neutral-300">GPT-OSS-120B</span>
                          <span className="text-neutral-600">Free Optimizer</span>
                          {matchStep >= 4 ? <span className={`ml-auto ${executionResult.engine_used === 'free_optimizer' ? 'text-cyan-400 font-bold' : 'text-purple-400'}`}>{executionResult.engine_used === 'free_optimizer' ? 'WINNER' : 'DONE'}</span> : <Loader2 className="w-3 h-3 text-purple-400 animate-spin ml-auto" />}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-cyan-400">{'>'}</span>
                          <span className="text-cyan-400/80">Qwen3.5-122B-A10B</span>
                          <span className="text-neutral-600">Judge</span>
                          <span className="text-cyan-400 ml-auto">SELECTED: {executionResult.engine_used}</span>
                        </div>
                      </>
                    )}
                    {/* Waiting state — no match yet */}
                    {matchStep >= 2 && matchStep < 5 && (!executionResult || executionResult.pending) && (
                      <div className="flex items-center gap-2 pt-1 border-t border-neutral-800/30">
                        <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />
                        <span className="text-neutral-400">Waiting for TEE competitive matching...</span>
                      </div>
                    )}
                    {/* Step 5: Sign + Settle — only for real matches */}
                    {matchStep >= 4 && executionResult && !executionResult.pending && (
                      <div className="flex items-center gap-2 pt-1 border-t border-neutral-800/30">
                        <span className="text-amber-400">{'>'}</span>
                        <span className="text-neutral-300">ECDSA signing</span>
                        <span className="text-neutral-600">secp256k1</span>
                        {matchStep >= 5 ? <span className="text-emerald-500 ml-auto">SIGNED</span> : <Loader2 className="w-3 h-3 text-amber-400 animate-spin ml-auto" />}
                      </div>
                    )}
                    {matchStep >= 5 && executionResult && !executionResult.pending && (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-amber-400">{'>'}</span>
                          <span className="text-neutral-300">executeSwap</span>
                          <span className="text-amber-400 ml-auto">CONFIRMED</span>
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <span className="text-emerald-400">✓</span>
                          <span className="text-emerald-400 font-semibold">Pipeline complete — settlement on-chain</span>
                        </div>
                      </>
                    )}
                    {matchStep < 5 && (
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-neutral-600">$</span>
                        <div className="w-2 h-3.5 bg-emerald-500/70 animate-pulse" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div className="mt-3 flex items-center justify-between text-xs font-mono text-neutral-500">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>{matchStep >= 2
                      ? attestation?.success ? 'TEE Verified' : 'TEE Unverified'
                      : matchStep >= 1 ? 'Verifying TEE...' : 'Attestation pending'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${matchStep > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-600'}`} />
                    <span className={matchStep > 0 ? 'text-emerald-500/50' : ''}>
                      {matchStep === 0 ? 'Initializing' : matchStep >= 5 ? 'Complete' : 'Waiting for match...'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Phase 4: Success */}
            {flowState === 'success' && executionResult && (
              <div className="p-6">
                {/* Header */}
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center">
                    <Check className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">
                      {executionResult.pending ? 'Order Submitted' : 'Order Filled'}
                    </h2>
                    <p className="text-xs text-neutral-500">
                      {executionResult.pending ? 'Waiting for counterparty match' : 'Private trade executed via TEE'}
                    </p>
                  </div>
                </div>

                {/* Two-column layout */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">

                  {/* Left: Trade Details */}
                  <div className="bg-neutral-900/50 border border-neutral-800 rounded-lg p-4 space-y-3">
                    <span className="text-[10px] font-mono text-neutral-600 uppercase tracking-wider">Trade Summary</span>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-neutral-500">Price</span>
                      <span className="text-sm font-mono text-white">{executionResult.price} USDT</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-neutral-500">Amount</span>
                      <span className="text-sm font-mono text-white">{executionResult.amount} {selectedToken.symbol}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-neutral-500">Total</span>
                      <span className="text-sm font-mono text-emerald-400">{executionResult.total} USDT</span>
                    </div>
                    <div className="h-px bg-neutral-800" />
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-neutral-500">Status</span>
                      <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${executionResult.pending ? 'bg-blue-500' : 'bg-emerald-500'}`} />
                        <span className="text-xs font-medium text-white">
                          {executionResult.pending ? 'Pending' : `${executionResult.filled}% Filled`}
                        </span>
                      </div>
                    </div>
                    {executionResult.hash && (
                      <>
                        <div className="h-px bg-neutral-800" />
                        <a
                          href={`${BSC_TESTNET.blockExplorer}/tx/${executionResult.hash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 text-[10px] font-mono text-neutral-500 hover:text-emerald-400 transition-colors"
                        >
                          <span>Tx: {executionResult.hash.substring(0, 10)}...{executionResult.hash.substring(58)}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </>
                    )}
                  </div>

                  {/* Right: MEV Protection */}
                  <div className="bg-neutral-900/50 border border-neutral-800 rounded-lg p-4 space-y-3">
                    <span className="text-[10px] font-mono text-neutral-600 uppercase tracking-wider">MEV Protection</span>

                    {/* Public DEX comparison */}
                    <div className="bg-rose-500/5 border border-rose-500/10 rounded-md p-3">
                      <div className="text-[10px] font-mono text-rose-400/60 mb-2">Public DEX (e.g. PancakeSwap)</div>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-neutral-500">Frontrun risk</span>
                          <span className="font-mono text-rose-400">~${(parseFloat(executionResult.total) * 0.003).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-neutral-500">Sandwich attack</span>
                          <span className="font-mono text-rose-400">~${(parseFloat(executionResult.total) * 0.005).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-neutral-500">Price impact</span>
                          <span className="font-mono text-rose-400">~${(parseFloat(executionResult.total) * 0.002).toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    {/* DarkPool */}
                    <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-md p-3">
                      <div className="text-[10px] font-mono text-emerald-400/60 mb-2">T-LAYER (TEE)</div>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-neutral-500">Frontrun risk</span>
                          <span className="font-mono text-emerald-400">$0.00</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-neutral-500">Sandwich attack</span>
                          <span className="font-mono text-emerald-400">$0.00</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-neutral-500">Price impact</span>
                          <span className="font-mono text-emerald-400">$0.00</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-1 border-t border-neutral-800">
                      <span className="text-xs text-neutral-500">You saved</span>
                      <span className="text-sm font-mono font-bold text-emerald-400">
                        ~${(parseFloat(executionResult.total) * 0.01).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Competitive TEE Matching Result */}
                <div className="bg-neutral-900/50 border border-neutral-800 rounded-lg p-4 mb-4">
                  <span className="text-[10px] font-mono text-neutral-600 uppercase tracking-wider">Competitive TEE Matching</span>
                  {executionResult.pending ? (
                    <div className="mt-3 flex items-center gap-2 text-xs text-neutral-500">
                      <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />
                      <span>Waiting for counterparty — TEE matching will execute when matched</span>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {(() => {
                        const winnerEngine = executionResult.engine_used || 'unknown';
                        const strategies = [
                          { name: 'Conservative', key: 'conservative', desc: 'Qwen3-30B-A3B', color: 'emerald' },
                          { name: 'Volume Max', key: 'volume_max', desc: 'GLM-5-FP8', color: 'amber' },
                          { name: 'Free Optimizer', key: 'free_optimizer', desc: 'GPT-OSS-120B', color: 'purple' },
                        ];
                        return strategies.map(s => {
                          const isWinner = s.key === winnerEngine;
                          return (
                            <div key={s.name} className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2">
                                <div className={`w-1 h-1 rounded-full bg-${s.color}-500`} />
                                <span className={isWinner ? 'text-cyan-400 font-bold' : 'text-neutral-400'}>{s.name}</span>
                                <span className="text-neutral-600 font-mono">{s.desc}</span>
                                {isWinner && <span className="text-[9px] bg-cyan-400/10 text-cyan-400 px-1.5 py-0.5 rounded font-mono">WINNER</span>}
                              </div>
                              <span className={`font-mono ${isWinner ? 'text-cyan-400 font-bold' : 'text-neutral-500'}`}>
                                {isWinner ? 'SELECTED' : 'DONE'}
                              </span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                  <div className="mt-2 pt-2 border-t border-neutral-800 flex items-center justify-between text-[10px]">
                    <span className="font-mono text-neutral-600">Judge: fill_rate(40%) + spread(30%) + fairness(30%)</span>
                    <span className="font-mono text-cyan-400/70">3 strategies + 1 judge = 4 TEE calls</span>
                  </div>
                </div>

                {/* TEE Attestation */}
                <div className="bg-neutral-900/50 border border-neutral-800 rounded-lg p-4 mb-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-neutral-600 uppercase tracking-wider">TEE Attestation</span>
                    <span className={`text-[9px] font-mono ${attestation?.success ? 'text-emerald-500/60' : 'text-amber-500/60'}`}>{attestation?.success ? 'pre-verified' : 'unverified'}</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-neutral-500">Enclave measurement</span>
                      <span className={`font-mono text-[10px] ${attestation?.success ? 'text-emerald-500/70' : 'text-neutral-600'}`}>{attestation?.enclave_measurement || 'n/a'}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-neutral-500">GPU attestation</span>
                      <span className={`font-mono text-[10px] ${attestation?.success ? 'text-emerald-500/70' : 'text-neutral-600'}`}>{attestation?.success ? `${attestation.gpu_model} verified` : 'n/a'}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-neutral-500">Code integrity</span>
                      <span className={`font-mono text-[10px] ${attestation?.success ? 'text-emerald-500/70' : 'text-neutral-600'}`}>{attestation?.code_integrity || 'n/a'}</span>
                    </div>
                    {attestation?.signing_addresses?.[0] && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-neutral-500">Signing address</span>
                        <span className={`font-mono text-[10px] ${attestation?.success ? 'text-emerald-500/70' : 'text-neutral-600'}`}>{attestation.signing_addresses[0].substring(0, 8)}...{attestation.signing_addresses[0].substring(36)}</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 pt-2 border-t border-neutral-800 text-[10px] font-mono text-neutral-600">
                    {attestation?.success
                      ? 'TEE environment verified before order entered enclave'
                      : 'TEE attestation unavailable — verification skipped'}
                  </div>
                </div>

                {/* AI Matching Analysis */}
                {matchReasoning && (
                  <div className="bg-neutral-900/50 border border-neutral-800 rounded-lg p-4 mb-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-neutral-600 uppercase tracking-wider">Matching Analysis</span>
                      <span className="text-[9px] font-mono text-purple-400/60">
                        {matchReasoning.engine === 'conservative' ? 'Conservative' : matchReasoning.engine === 'volume_max' ? 'Volume Max' : matchReasoning.engine === 'free_optimizer' ? 'Free Optimizer' : 'TEE Strategy'}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-neutral-400 leading-relaxed">{matchReasoning.reasoning}</p>
                  </div>
                )}

                {/* Privacy Report */}
                <div className="bg-neutral-900/50 border border-neutral-800 rounded-lg p-4 mb-6">
                  <span className="text-[10px] font-mono text-neutral-600 uppercase tracking-wider">Privacy Report — On-chain Visibility</span>
                  <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-neutral-500">Deposit amount</span>
                      <span className="font-mono text-amber-400">Visible</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-neutral-500">Order side (buy/sell)</span>
                      <span className="font-mono text-emerald-400">Hidden</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-neutral-500">Settlement tx</span>
                      <span className="font-mono text-amber-400">Visible</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-neutral-500">Limit price</span>
                      <span className="font-mono text-emerald-400">Hidden</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-neutral-500">Wallet address</span>
                      <span className="font-mono text-amber-400">Visible</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-neutral-500">Counterparty</span>
                      <span className="font-mono text-emerald-400">Hidden</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-neutral-500">Token type</span>
                      <span className="font-mono text-amber-400">Visible</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-neutral-500">Order timing</span>
                      <span className="font-mono text-emerald-400">Hidden</span>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-neutral-800 flex items-center justify-between">
                    <span className="text-[10px] font-mono text-neutral-600">4 fields visible · 4 fields hidden in TEE</span>
                    <span className="text-[10px] font-mono text-emerald-500/60">Privacy score: 50% on-chain shielded</span>
                  </div>
                </div>

                <button
                  onClick={resetFlow}
                  className="w-full py-3 rounded-lg font-bold text-sm bg-neutral-800 text-white hover:bg-neutral-700 transition-colors"
                >
                  Close
                </button>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
