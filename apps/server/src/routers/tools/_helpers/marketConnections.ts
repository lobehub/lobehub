import type { ListConnectionsResponse, MarketSDK } from '@lobehub/market-sdk';

export const MARKET_CONNECTIONS_REQUEST_TIMEOUT_MS = 10_000;

type MarketConnectClient = Pick<MarketSDK['connect'], 'listConnections'>;

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
