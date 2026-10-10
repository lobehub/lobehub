import { isOfficialCloudServer } from '@lobechat/const';
import {
  type DeviceGatewayDiscovery,
  type DeviceGatewayEndpoint,
  type DeviceGatewayResolution,
  type DeviceGatewayUrlSource,
  parseDeviceGatewayDiscovery,
  resolveDeviceGatewayEndpoint,
} from '@lobechat/device-gateway-client';

import { createPublicLambdaClient } from '../api/client';
import { CLI_PRIMARY_BIN } from '../constants/identity';
import { OFFICIAL_GATEWAY_URL } from '../constants/urls';
import { redactUrlCredentials, redactUrlsInMessage } from '../doctor/redact';
import { loadDeviceGatewayUrl, saveDeviceGatewayUrl } from '../settings';
import { formatError, isTransientNetworkError } from '../utils/error';

/** A config read that hangs must not hold `connect` / `status` / `doctor` forever. */
const DISCOVERY_TIMEOUT_MS = 10_000;
/** Same budget as the workspace token mint: ride out a blip, still fail before startup times out. */
const DISCOVERY_RETRY_DELAYS_MS = [250, 1000, 2500];

export type DeviceGatewayFailure = Extract<DeviceGatewayResolution, { ok: false }>;

/**
 * Ask `serverUrl` which Device Gateway its clients should use. Anonymous on
 * purpose — the address is public — and never throws: an unreachable server,
 * an error status or a body that is not a global config is `failed`, distinct
 * from a server that simply advertises nothing.
 */
export async function discoverDeviceGateway(serverUrl: string): Promise<DeviceGatewayDiscovery> {
  const client = createPublicLambdaClient(serverUrl);

  for (let attempt = 0; ; attempt += 1) {
    try {
      const config = await client.config.getGlobalConfig.query(undefined, {
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      return parseDeviceGatewayDiscovery(config);
    } catch (error) {
      // Retry the same server only; a failure never moves on to another gateway.
      const delay = DISCOVERY_RETRY_DELAYS_MS[attempt];
      if (delay !== undefined && isTransientNetworkError(error)) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      // The whole cause chain: "fetch failed" alone does not say refused vs DNS vs TLS.
      return { reason: redactUrlsInMessage(formatError(error)), status: 'failed' };
    }
  }
}

/**
 * The Device Gateway for a credential's server — `auth.serverUrl` as resolved
 * with the token, so the address, the server and the token always belong to
 * one login. `connect`, `status` and `doctor` all resolve through here.
 *
 * Order: `--gateway`, then the address saved for this server (both without
 * asking it), then what the server advertises, then — when it advertises
 * nothing — the official gateway for official cloud. A self-hosted server
 * keeps needing an address, as before discovery existed. A failed lookup is an
 * error, never a reason to try another deployment's gateway.
 */
export async function resolveCliDeviceGateway({
  override,
  serverUrl,
}: {
  override?: string;
  serverUrl: string;
}): Promise<DeviceGatewayResolution> {
  return resolveDeviceGatewayEndpoint({
    discover: () => discoverDeviceGateway(serverUrl),
    manualUrl: loadDeviceGatewayUrl(serverUrl),
    officialGatewayUrl: isOfficialCloudServer(serverUrl) ? OFFICIAL_GATEWAY_URL : undefined,
    override,
  });
}

/**
 * Keep an explicit `--gateway` as this server's saved address, reused by later
 * runs ahead of whatever the server advertises — and only for this server.
 *
 * @returns whether anything changed.
 */
export function rememberGatewayOverride(
  serverUrl: string,
  endpoint: DeviceGatewayEndpoint,
): boolean {
  if (endpoint.source !== 'override') return false;
  if (loadDeviceGatewayUrl(serverUrl) === endpoint.url) return false;

  saveDeviceGatewayUrl(serverUrl, endpoint.url);
  return true;
}

const SOURCE_LABELS: Record<DeviceGatewayUrlSource, string> = {
  manual: 'saved for this server',
  official: 'official default',
  override: '--gateway',
  server: 'advertised by the server',
};

/** `https://gw.example.com (advertised by the server)`, safe to print. */
export function describeDeviceGateway(endpoint: DeviceGatewayEndpoint): string {
  return `${redactUrlCredentials(endpoint.url)} (${SOURCE_LABELS[endpoint.source]})`;
}

/** What went wrong and what to do about it, safe to print. */
export function describeDeviceGatewayFailure(
  failure: DeviceGatewayFailure,
  serverUrl: string,
): { detail: string; fix: string } {
  const server = redactUrlCredentials(serverUrl);
  const remember = `Run '${CLI_PRIMARY_BIN} connect --gateway <url>' once with this server's device gateway; it is remembered for ${server} only.`;

  switch (failure.reason) {
    case 'discovery_failed': {
      return {
        detail: `Could not read the device gateway address from ${server}: ${failure.detail ?? 'unknown error'}.`,
        fix: `Check that ${server} is reachable and is the server you logged in to, then retry. A gateway set with '--gateway <url>' is remembered for this server and skips the lookup.`,
      };
    }
    case 'invalid_advertised_url': {
      return {
        detail: `${server} advertises a device gateway address that is not a valid http(s) URL.`,
        fix: `Ask the server administrator to fix DEVICE_GATEWAY_PUBLIC_URL. Until then: ${remember}`,
      };
    }
    case 'invalid_manual': {
      return {
        detail: `The device gateway address saved for ${server} is not a valid http(s) URL.`,
        fix: `Replace it: ${remember}`,
      };
    }
    case 'invalid_override': {
      return {
        detail: '--gateway is not a valid http(s) URL without credentials, query or fragment.',
        fix: 'Pass the gateway base URL, e.g. --gateway https://gateway.example.com',
      };
    }
    case 'not_configured': {
      return {
        detail: `${server} does not advertise a device gateway, and none is saved for it.`,
        fix: remember,
      };
    }
  }
}
