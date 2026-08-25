import { getBusinessTrpcHeaders } from '@/business/client/trpc-headers';

import {
  parseRealtimeAsrSessionResponse,
  type RealtimeAsrSessionResponse,
  RealtimeDictationError,
} from './contract';

const mapSessionError = (status: number) => {
  if (status === 401 || status === 403) return new RealtimeDictationError('AUTH_FAILED', false);
  if (status === 402) return new RealtimeDictationError('PROVIDER_BILLING_BLOCKED', false);
  if (status === 429) return new RealtimeDictationError('SESSION_LIMIT_EXCEEDED', true);
  if (status === 404) return new RealtimeDictationError('PROVIDER_NOT_CONFIGURED', false);
  if (status >= 500) return new RealtimeDictationError('PROVIDER_UNAVAILABLE', true);
  return new RealtimeDictationError('SESSION_CREATE_FAILED', false);
};

export const createRealtimeAsrSession = async (
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<RealtimeAsrSessionResponse> => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const businessHeaders = await getBusinessTrpcHeaders();
  for (const [key, value] of Object.entries(businessHeaders)) headers.set(key, value);

  let response: Response;
  try {
    response = await fetcher('/api/asr/realtime/session', {
      body: JSON.stringify({ platform: 'web' }),
      headers,
      method: 'POST',
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new RealtimeDictationError('NETWORK_DISCONNECTED', true);
  }

  if (!response.ok) throw mapSessionError(response.status);

  try {
    return parseRealtimeAsrSessionResponse(await response.json());
  } catch (error) {
    if (error instanceof RealtimeDictationError) throw error;
    throw new RealtimeDictationError('PROTOCOL_ERROR', false);
  }
};
