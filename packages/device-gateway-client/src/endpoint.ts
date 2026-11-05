/**
 * Device Gateway address discovery, shared by the desktop main process and the
 * CLI. Pure: callers own the I/O (how the server's global config is fetched,
 * where per-server addresses are stored) and pass the results in, so both
 * clients apply one precedence and one validation rule.
 *
 * Precedence for a new connection:
 *   1. an explicit override for this run (desktop `DEVICE_GATEWAY_URL`, CLI `--gateway`)
 *   2. the address the user saved for the current server
 *   3. the address the current server advertises (`serverConfig.deviceGatewayUrl`)
 *   4. the official gateway, when the server answered without advertising one
 *      and the caller allows that default
 *
 * The server is only asked when neither 1 nor 2 applies. A failed or malformed
 * discovery is an error, never "nothing advertised": falling through would hand
 * this server's token to a gateway it never chose.
 */

export type DeviceGatewayUrlSource = 'manual' | 'official' | 'override' | 'server';

export interface DeviceGatewayEndpoint {
  source: DeviceGatewayUrlSource;
  url: string;
}

export type DeviceGatewayDiscovery =
  | { status: 'absent' }
  | { status: 'advertised'; url: string }
  /** The request failed, answered non-2xx, or the body is not a global config. */
  | { reason: string; status: 'failed' }
  /** The server advertised a value that is not a usable gateway base URL. */
  | { reason: string; status: 'invalid' };

export type DeviceGatewayResolutionFailure =
  | 'discovery_failed'
  | 'invalid_advertised_url'
  | 'invalid_manual'
  | 'invalid_override'
  /** The server advertises nothing and the caller has no default for it. */
  | 'not_configured';

export type DeviceGatewayResolution<
  Failure extends DeviceGatewayResolutionFailure = DeviceGatewayResolutionFailure,
> = { endpoint: DeviceGatewayEndpoint; ok: true } | { detail?: string; ok: false; reason: Failure };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseHttpUrl = (value: unknown): URL | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
};

const stripTrailingSlashes = (pathname: string) => pathname.replace(/\/+$/, '');

/**
 * Normalize a Device Gateway base URL, or `undefined` when it is unusable.
 * Same rule the server applies to `DEVICE_GATEWAY_PUBLIC_URL`: http(s), no
 * credentials, query or fragment; a path prefix is kept, trailing `/` dropped.
 */
export const normalizeDeviceGatewayUrl = (value: unknown): string | undefined => {
  const url = parseHttpUrl(value);
  if (!url) return undefined;
  if (url.username || url.password || /[?#]/.test((value as string).trim())) return undefined;

  return `${url.origin}${stripTrailingSlashes(url.pathname)}`;
};

/**
 * Stable key for "this server", used to bind per-server state (a saved gateway
 * address, workspace enrollments) so it never leaks to another instance.
 */
export const deviceGatewayServerKey = (serverUrl: string): string | undefined => {
  const url = parseHttpUrl(serverUrl);
  return url ? `${url.origin}${stripTrailingSlashes(url.pathname)}` : undefined;
};

/** WebSocket endpoint for a gateway base URL: `ws(s)://<host><prefix>/ws`. */
export const toDeviceGatewayWebSocketUrl = (gatewayUrl: string): URL => {
  const url = new URL(gatewayUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${stripTrailingSlashes(url.pathname)}/ws`;
  url.search = '';
  url.hash = '';
  return url;
};

/**
 * Read the advertised address out of a `config.getGlobalConfig` result. An
 * omitted field is the only "absent"; anything else that is not a usable URL
 * (including `null` or an empty string) is `invalid`.
 */
export const parseDeviceGatewayDiscovery = (globalConfig: unknown): DeviceGatewayDiscovery => {
  if (!isRecord(globalConfig) || !isRecord(globalConfig.serverConfig))
    return { reason: 'the server response is not a global config', status: 'failed' };

  const { serverConfig } = globalConfig;
  if (!('deviceGatewayUrl' in serverConfig) || serverConfig.deviceGatewayUrl === undefined)
    return { status: 'absent' };

  const url = normalizeDeviceGatewayUrl(serverConfig.deviceGatewayUrl);
  return url
    ? { status: 'advertised', url }
    : { reason: 'the advertised device gateway URL is not a valid http(s) URL', status: 'invalid' };
};

const INVALID_ADDRESS_DETAIL = 'not a valid http(s) URL without credentials, query or fragment';

const explicitEndpoint = (
  value: string | undefined,
  source: 'manual' | 'override',
): DeviceGatewayResolution | undefined => {
  if (value === undefined || value.trim() === '') return undefined;

  const url = normalizeDeviceGatewayUrl(value);
  if (url) return { endpoint: { source, url }, ok: true };

  return {
    detail: `the ${source === 'override' ? 'override' : 'saved address'} is ${INVALID_ADDRESS_DETAIL}`,
    ok: false,
    reason: source === 'override' ? 'invalid_override' : 'invalid_manual',
  };
};

export interface ResolveDeviceGatewayEndpointParams {
  /** Fetch and parse the current server's global config. Must not throw. */
  discover: () => Promise<DeviceGatewayDiscovery>;
  /** Address the user saved for the current server. Beats the advertisement. */
  manualUrl?: string;
  /**
   * Used when the server answers without advertising an address. Omit it to
   * report `not_configured` instead.
   */
  officialGatewayUrl?: string;
  /** Explicit address for this run; beats everything else. */
  override?: string;
}

/** What a caller that always supplies the official default can get back. */
export type DeviceGatewayResolutionWithDefault = DeviceGatewayResolution<
  Exclude<DeviceGatewayResolutionFailure, 'not_configured'>
>;

export function resolveDeviceGatewayEndpoint(
  params: ResolveDeviceGatewayEndpointParams & { officialGatewayUrl: string },
): Promise<DeviceGatewayResolutionWithDefault>;
export function resolveDeviceGatewayEndpoint(
  params: ResolveDeviceGatewayEndpointParams,
): Promise<DeviceGatewayResolution>;
export async function resolveDeviceGatewayEndpoint({
  discover,
  manualUrl,
  officialGatewayUrl,
  override,
}: ResolveDeviceGatewayEndpointParams): Promise<DeviceGatewayResolution> {
  const explicit = explicitEndpoint(override, 'override') ?? explicitEndpoint(manualUrl, 'manual');
  if (explicit) return explicit;

  const discovery = await discover();
  switch (discovery.status) {
    case 'advertised': {
      return { endpoint: { source: 'server', url: discovery.url }, ok: true };
    }
    case 'failed': {
      return { detail: discovery.reason, ok: false, reason: 'discovery_failed' };
    }
    case 'invalid': {
      return { detail: discovery.reason, ok: false, reason: 'invalid_advertised_url' };
    }
    case 'absent': {
      return officialGatewayUrl
        ? { endpoint: { source: 'official', url: officialGatewayUrl }, ok: true }
        : { ok: false, reason: 'not_configured' };
    }
  }
}
