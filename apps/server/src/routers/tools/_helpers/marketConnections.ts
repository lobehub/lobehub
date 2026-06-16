import type { ListConnectionsResponse, MarketSDK } from '@lobehub/market-sdk';

export const MARKET_CONNECTIONS_REQUEST_TIMEOUT_MS = 10_000;

type MarketConnectClient = Pick<MarketSDK['connect'], 'listConnections'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getStringField = (value: unknown, key: string) => {
  if (!isRecord(value)) return;

  const field = value[key];
  return typeof field === 'string' ? field : undefined;
};

const includesAuthError = (value?: string) => {
  const normalized = value?.toLowerCase();

  if (!normalized) return false;

  return (
    normalized === 'unauthorized' ||
    normalized === 'invalid_token' ||
    normalized === 'token_expired' ||
    normalized.includes('missing bearer token') ||
    normalized.includes('unauthorized') ||
    normalized.includes('invalid_token') ||
    normalized.includes('token expired')
  );
};

export const isMarketConnectionsAuthError = (error: unknown): boolean => {
  if (!isRecord(error)) return false;

  const status = error.status;
  const errorBody = error.errorBody;

  return (
    status === 401 ||
    includesAuthError(getStringField(error, 'name')) ||
    includesAuthError(getStringField(error, 'message')) ||
    includesAuthError(getStringField(errorBody, 'error')) ||
    includesAuthError(getStringField(errorBody, 'error_description'))
  );
};

export const isMarketConnectionsTimeoutError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

export const listMarketConnectionsWithTimeout = async (
  marketConnect: MarketConnectClient,
  timeoutMs = MARKET_CONNECTIONS_REQUEST_TIMEOUT_MS,
): Promise<ListConnectionsResponse> => {
  return marketConnect.listConnections({
    signal: AbortSignal.timeout(timeoutMs),
  });
};

export const listOptionalMarketConnectionsWithTimeout = async (
  marketConnect: MarketConnectClient,
  timeoutMs = MARKET_CONNECTIONS_REQUEST_TIMEOUT_MS,
): Promise<ListConnectionsResponse> => {
  try {
    return await listMarketConnectionsWithTimeout(marketConnect, timeoutMs);
  } catch (error) {
    if (isMarketConnectionsAuthError(error)) {
      return { connections: [], success: true };
    }

    throw error;
  }
};
