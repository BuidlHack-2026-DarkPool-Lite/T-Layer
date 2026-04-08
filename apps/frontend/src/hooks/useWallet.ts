import { useCallback } from 'react';
import { useAccount, useConnect, useConnectors, useDisconnect, useSwitchChain } from 'wagmi';
import { bscTestnet } from 'wagmi/chains';
import { BSC_TESTNET } from '../config';

interface WalletState {
  address: string | null;
  isConnected: boolean;
  chainId: number | null;
  isCorrectChain: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToTestnet: () => Promise<void>;
}

/**
 * 지갑 연결/체인 상태를 wagmi 훅 위에서 얇게 감싼 어댑터.
 *
 * 기존 ethers 기반 useWallet의 공개 인터페이스(`provider`/`signer` 제외)를
 * 그대로 보존해서 App.tsx 변경 면적을 최소화한다. 컨트랙트 호출은 별도의
 * useEscrow 훅이 wagmi config로부터 wallet client를 직접 얻어 처리한다.
 */
export function useWallet(): WalletState {
  // chainId는 wallet-scoped 값을 쓴다. useChainId()는 미연결 상태에서도
  // config의 active chain을 그대로 반환해서 isCorrectChain false positive를 만든다.
  const { address, isConnected, chainId } = useAccount();
  const isCorrectChain = isConnected && chainId === BSC_TESTNET.chainId;

  const connectors = useConnectors();
  const { connectAsync } = useConnect();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();

  const connect = useCallback(async () => {
    // 첫 번째 injected 커넥터 사용 (config에 injected()만 등록되어 있음).
    const injected = connectors[0];
    if (!injected) {
      window.open('https://metamask.io/download/', '_blank');
      return;
    }
    await connectAsync({ connector: injected });
  }, [connectors, connectAsync]);

  const disconnect = useCallback(() => {
    wagmiDisconnect();
  }, [wagmiDisconnect]);

  const switchToTestnet = useCallback(async () => {
    await switchChainAsync({ chainId: bscTestnet.id });
  }, [switchChainAsync]);

  return {
    address: address ?? null,
    isConnected,
    chainId: chainId ?? null,
    isCorrectChain,
    connect,
    disconnect,
    switchToTestnet,
  };
}
