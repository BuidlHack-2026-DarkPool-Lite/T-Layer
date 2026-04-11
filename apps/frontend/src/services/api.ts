import { config } from '../config';

export interface OrderCreateParams {
  token_pair: string;
  side: 'buy' | 'sell';
  amount: string;
  limit_price: string;
  wallet_address: string;
}

export interface OrderResponse {
  order_id: string;
  token_pair: string;
  side: string;
  amount: string;
  filled_amount: string;
  remaining: string;
  limit_price: string;
  wallet_address: string;
  status: string;
  created_at: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${config.API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API Error ${res.status}: ${body}`);
  }

  return res.json();
}

/** 주문 생성 — POST /order */
export async function createOrder(params: OrderCreateParams): Promise<OrderResponse> {
  return request<OrderResponse>('/order', {
    method: 'POST',
    body: JSON.stringify({
      token_pair: params.token_pair,
      side: params.side,
      amount: parseFloat(params.amount),
      limit_price: parseFloat(params.limit_price),
      wallet_address: params.wallet_address,
    }),
  });
}

/** 주문 상태 조회 — GET /order/:id/status */
export async function getOrderStatus(orderId: string): Promise<OrderResponse> {
  return request<OrderResponse>(`/order/${orderId}/status`);
}

/** 주문 취소 — DELETE /order/:id */
export async function cancelOrderApi(orderId: string): Promise<OrderResponse> {
  return request<OrderResponse>(`/order/${orderId}`, { method: 'DELETE' });
}

/** TEE Attestation 검증 결과 */
export interface AttestationResult {
  success: boolean;
  enclave_measurement: string;
  signing_addresses: string[];
  gpu_verified: boolean;
  gpu_model: string;
  code_integrity: string;
  timestamp: string;
}

/** TEE 환경 사전 검증 — GET /attestation/verify */
export async function verifyAttestation(): Promise<AttestationResult> {
  return request<AttestationResult>('/attestation/verify');
}
