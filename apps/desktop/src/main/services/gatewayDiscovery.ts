import {
  type DeviceGatewayDiscovery,
  parseDeviceGatewayDiscovery,
} from '@lobechat/device-gateway-client/endpoint';

import { appendVercelCookie } from '@/utils/http-headers';
import { netFetch } from '@/utils/net-fetch';
import { setDesktopUserAgentHeader } from '@/utils/user-agent';

/** A config read that hangs must not hold the connection in "connecting" forever. */
const DISCOVERY_TIMEOUT_MS = 10_000;

/**
 * Ask `serverUrl` which Device Gateway its clients should use, through the
 * public `config.getGlobalConfig` query. Sent without credentials: the address
 * is public, and a token that is about to be refreshed must not turn into a
 * config error. Uses Electron's network stack so a self-hosted server behind a
 * system-trusted private CA works the same as it does for sign-in.
 *
 * Never throws — a failed request, a non-2xx answer and a body that is not a
 * global config all come back as `failed`, distinct from "nothing advertised".
 */
export const discoverDeviceGateway = async (
  serverUrl: string,
  signal: AbortSignal,
): Promise<DeviceGatewayDiscovery> => {
  const headers: Record<string, string> = { accept: 'application/json' };
  appendVercelCookie(headers);
  setDesktopUserAgentHeader(headers);

  let response: Response;
  try {
    response = await netFetch(
      `${serverUrl.replace(/\/+$/, '')}/trpc/lambda/config.getGlobalConfig`,
      {
        headers,
        method: 'GET',
        signal: AbortSignal.any([signal, AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)]),
      },
    );
  } catch (error) {
    return {
      reason: signal.aborted
        ? 'cancelled'
        : `request failed: ${error instanceof Error ? error.message : String(error)}`,
      status: 'failed',
    };
  }

  if (!response.ok) return { reason: `HTTP ${response.status}`, status: 'failed' };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { reason: 'the response is not JSON', status: 'failed' };
  }

  // tRPC + superjson envelope: `{ result: { data: { json, meta? } } }`.
  const json = (payload as { result?: { data?: { json?: unknown } } } | null)?.result?.data?.json;
  return parseDeviceGatewayDiscovery(json);
};
