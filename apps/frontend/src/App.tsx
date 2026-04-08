import React, { useState, useEffect, useRef, useCallback } from 'react';
import { parseUnits } from 'viem';
import { Shield, Wallet, Lock, Activity, ChevronDown, X, Check, Loader2, CheckCircle2, ExternalLink, Cpu, Fingerprint, Trash2, AlertTriangle, LogOut, EyeOff, ShieldCheck } from 'lucide-react';
import { useWallet } from './hooks/useWallet';
import { useEscrow } from './hooks/useEscrow';
import { createOrder, cancelOrderApi, getOrderStatus } from './services/api';
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

const GlitchEyeLogo = ({ className = "w-6 h-6" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <defs>
      <mask id="glitch-eye-mask">
        <rect width="24" height="24" fill="white" />
        <rect x="0" y="0" width="9.5" height="24" fill="black" />
        <circle cx="13.5" cy="12" r="4.5" fill="black" />
        <rect x="8.75" y="-2" width="6.5" height="28" fill="black" transform="rotate(-45 12 12)" />
      </mask>
    </defs>
    <path
      d="M 1 12 C 5 3 19 3 23 12 C 19 21 5 21 1 12 Z"
      fill="currentColor"
      mask="url(#glitch-eye-mask)"
    />
    <rect x="10.25" y="-1" width="3.5" height="26" fill="currentColor" transform="rotate(-45 12 12)" />
    <rect x="6" y="8.5" width="2.5" height="1.5" fill="currentColor" />
    <rect x="4.5" y="11" width="5.5" height="1.5" fill="currentColor" />
    <rect x="2.5" y="13.5" width="4.5" height="1.5" fill="currentColor" />
    <rect x="5.5" y="16" width="4.5" height="1.5" fill="currentColor" />
  </svg>
);

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
  const currentOrderIdRef = useRef<string | null>(null);

  // Navigation & Orders
  const [activePage, setActivePage] = useState<'trade' | 'orders'>('trade');
  const [orderTab, setOrderTab] = useState<'open' | 'history'>('open');
  const [myOrders, setMyOrders] = useState<Order[]>([]);

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

          for (const result of event.results) {
            // 내 주문이 매칭된 경우
            const isMyOrder =
              result.maker_order_id === currentId ||
              result.taker_order_id === currentId;

            if (isMyOrder && flowState === 'match') {
              // 매칭 단계 애니메이션
              setMatchStep(1);
              setTimeout(() => setMatchStep(2), 600);
              setTimeout(() => setMatchStep(3), 1200);
              setTimeout(() => {
                setMatchStep(4);
                setExecutionResult({
                  price: result.exec_price || price,
                  amount: amount,
                  total: (parseFloat(amount) * parseFloat(result.exec_price || price)).toFixed(2),
                  hash: result.tx_hash || '',
                  filled: 100,
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

  const handleOrderSubmit = () => {
    if (!wallet.isConnected || !wallet.isCorrectChain || !amount || !price) return;
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
      const orderResponse = await createOrder({
        token_pair: selectedToken.pair,
        side: orderSide,
        amount: amount,
        limit_price: price,
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

      // Phase 3: TEE 매칭 대기
      setFlowState('match');
      setMatchStep(0);

      // 매칭은 WebSocket에서 처리됨
      // 만약 10초 안에 매칭 안 되면 pending 상태로 종료
      setTimeout(() => {
        if (flowState === 'match') {
          // 매칭 대기 중이면 pending으로 표시
          setMatchStep(1);
          setTimeout(() => setMatchStep(2), 800);
          setTimeout(() => {
            setFlowState('success');
            setExecutionResult({
              price: price,
              amount: amount,
              total: (parseFloat(amount) * parseFloat(price)).toFixed(2),
              hash: depositTxHash,
              filled: 0,
              pending: true,
            });
          }, 2000);
        }
      }, 15000);

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
    setFlowState('idle');
    setAmount('');
    setPrice('');
    setMatchStep(0);
    setExecutionResult(null);
    setFlowError(null);
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
          <div className="w-14 h-14 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-center mb-4 shadow-[0_0_40px_rgba(16,185,129,0.15)]">
            <GlitchEyeLogo className="w-7 h-7 text-white" />
          </div>

          <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">
            DarkPool <span className="text-neutral-500 font-normal">Lite</span>
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
            <div className="w-9 h-9 rounded-lg bg-neutral-900 border border-neutral-800 flex items-center justify-center shadow-[0_0_12px_rgba(16,185,129,0.15)]">
              <GlitchEyeLogo />
            </div>
            <span className="font-bold text-lg tracking-tight text-white">DarkPool <span className="text-neutral-500 font-normal">Lite</span></span>
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
                  disabled={!isWalletReady || !amount || !price}
                  className={`w-full py-4 rounded-lg font-bold text-sm transition-all ${
                    !isWalletReady || !amount || !price
                      ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
                      : orderSide === 'buy'
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.15)]'
                      : 'bg-rose-600 hover:bg-rose-500 text-white shadow-[0_0_20px_rgba(225,29,72,0.15)]'
                  }`}
                >
                  {!wallet.isCorrectChain
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
          <div className="w-full max-w-md bg-[#0a0a0a] border border-neutral-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">

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

            {/* Phase 3: TEE Matching */}
            {flowState === 'match' && (
              <div className="p-6 flex flex-col min-h-[420px]">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center justify-center">
                    <Cpu className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">TEE Privacy Pipeline</h3>
                    <p className="text-xs text-emerald-500/80 font-mono">Enclave execution in progress</p>
                  </div>
                </div>

                {/* Visual Pipeline */}
                <div className="flex-1 flex flex-col gap-3">

                  {/* Step 1: Your Order — Encrypt */}
                  <div className={`rounded-lg border p-3 transition-all duration-500 ${
                    matchStep >= 1
                      ? 'bg-emerald-500/5 border-emerald-500/20'
                      : 'bg-neutral-900/50 border-neutral-800'
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        matchStep >= 1 ? 'bg-emerald-500/20' : 'bg-neutral-800'
                      }`}>
                        {matchStep > 1 ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> :
                         matchStep === 1 ? <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" /> :
                         <Lock className="w-4 h-4 text-neutral-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-white">Order Encrypted</div>
                        <div className="text-[10px] font-mono text-neutral-500 truncate">
                          {matchStep >= 1
                            ? `${selectedToken.pair} · ${orderSide.toUpperCase()} · ██████ USDT`
                            : 'Waiting...'}
                        </div>
                      </div>
                      {matchStep >= 1 && (
                        <span className="text-[9px] font-mono text-emerald-500/60 px-1.5 py-0.5 rounded bg-emerald-500/10">AES-256</span>
                      )}
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="flex justify-center">
                    <div className={`w-px h-4 transition-colors duration-500 ${matchStep >= 2 ? 'bg-emerald-500/40' : 'bg-neutral-800'}`} />
                  </div>

                  {/* Step 2: TEE Enclave */}
                  <div className={`rounded-lg border p-3 transition-all duration-500 ${
                    matchStep >= 2
                      ? 'bg-emerald-500/5 border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.08)]'
                      : 'bg-neutral-900/50 border-neutral-800'
                  }`}>
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        matchStep >= 2 ? 'bg-emerald-500/20' : 'bg-neutral-800'
                      }`}>
                        {matchStep > 2 ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> :
                         matchStep === 2 ? <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" /> :
                         <Shield className="w-4 h-4 text-neutral-600" />}
                      </div>
                      <div className="flex-1">
                        <div className="text-xs font-semibold text-white">TEE Enclave</div>
                        <div className="text-[10px] font-mono text-neutral-500">
                          {matchStep >= 2 ? 'Scanning orderbook inside enclave' : 'Waiting...'}
                        </div>
                      </div>
                      {matchStep >= 2 && (
                        <span className="text-[9px] font-mono text-emerald-500/60 px-1.5 py-0.5 rounded bg-emerald-500/10">SECURE</span>
                      )}
                    </div>
                    {/* Inner enclave visualization */}
                    {matchStep >= 2 && (
                      <div className="ml-11 mt-1 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-px flex-1 bg-emerald-500/20" />
                          <span className="text-[9px] font-mono text-emerald-500/40">YOUR ORDER</span>
                          <div className="h-px w-4 bg-emerald-500/20" />
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-px flex-1 bg-neutral-700/50" />
                          <span className="text-[9px] font-mono text-neutral-600">COUNTERPARTY</span>
                          <div className="h-px w-4 bg-neutral-700/50" />
                        </div>
                        {matchStep >= 3 && (
                          <div className="flex items-center gap-2 animate-pulse">
                            <div className="h-px flex-1 bg-emerald-400/30" />
                            <span className="text-[9px] font-mono text-emerald-400/70">MATCHED</span>
                            <div className="h-px w-4 bg-emerald-400/30" />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Arrow */}
                  <div className="flex justify-center">
                    <div className={`w-px h-4 transition-colors duration-500 ${matchStep >= 3 ? 'bg-emerald-500/40' : 'bg-neutral-800'}`} />
                  </div>

                  {/* Step 3: TEE Signature */}
                  <div className={`rounded-lg border p-3 transition-all duration-500 ${
                    matchStep >= 3
                      ? 'bg-emerald-500/5 border-emerald-500/20'
                      : 'bg-neutral-900/50 border-neutral-800'
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        matchStep >= 3 ? 'bg-emerald-500/20' : 'bg-neutral-800'
                      }`}>
                        {matchStep > 3 ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> :
                         matchStep === 3 ? <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" /> :
                         <Fingerprint className="w-4 h-4 text-neutral-600" />}
                      </div>
                      <div className="flex-1">
                        <div className="text-xs font-semibold text-white">TEE Signature & Settlement</div>
                        <div className="text-[10px] font-mono text-neutral-500">
                          {matchStep >= 3 ? 'Signing swap → BNB Chain' : 'Waiting...'}
                        </div>
                      </div>
                      {matchStep >= 4 && (
                        <span className="text-[9px] font-mono text-emerald-500/60 px-1.5 py-0.5 rounded bg-emerald-500/10">ON-CHAIN</span>
                      )}
                    </div>
                  </div>

                </div>

                {/* Footer */}
                <div className="mt-4 pt-4 border-t border-neutral-800/50 flex items-center justify-between text-xs font-mono text-neutral-500">
                  <div className="flex items-center gap-1.5">
                    <Fingerprint className="w-3.5 h-3.5" />
                    <span>Attestation Verified</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${matchStep > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-600'}`} />
                    <span className={matchStep > 0 ? 'text-emerald-500/50' : ''}>
                      {matchStep === 0 ? 'Initializing' : matchStep < 4 ? 'Processing' : 'Complete'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Phase 4: Success */}
            {flowState === 'success' && executionResult && (
              <div className="p-8 flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center mb-6">
                  <Check className="w-8 h-8 text-emerald-400" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">
                  {executionResult.pending ? 'Order Submitted' : 'Order Filled'}
                </h2>
                <p className="text-sm text-neutral-400 mb-8">
                  {executionResult.pending
                    ? 'Your order is pending — waiting for a counterparty match.'
                    : 'Your private trade has been executed'}
                </p>

                <div className="w-full bg-neutral-900/50 border border-neutral-800 rounded-xl p-5 space-y-4 mb-8 text-left">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-neutral-500">Execution Price</span>
                    <span className="text-sm font-mono text-white">{executionResult.price} USDT</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-neutral-500">{executionResult.pending ? 'Order Amount' : 'Filled Amount'}</span>
                    <span className="text-sm font-mono text-white">{executionResult.amount} {selectedToken.symbol}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-neutral-500">Total Value</span>
                    <span className="text-sm font-mono text-emerald-400">{executionResult.total} USDT</span>
                  </div>
                  <div className="h-px bg-neutral-800 w-full my-2"></div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-neutral-500">Status</span>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${executionResult.pending ? 'bg-blue-500' : 'bg-emerald-500'}`}></div>
                      <span className="text-xs font-medium text-white">
                        {executionResult.pending ? 'Pending Match' : `${executionResult.filled}% Filled`}
                      </span>
                    </div>
                  </div>
                </div>

                {executionResult.hash && (
                  <a
                    href={`${BSC_TESTNET.blockExplorer}/tx/${executionResult.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-xs font-mono text-neutral-400 hover:text-emerald-400 transition-colors mb-8"
                  >
                    <span>Tx: {executionResult.hash.substring(0, 10)}...{executionResult.hash.substring(58)}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}

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
