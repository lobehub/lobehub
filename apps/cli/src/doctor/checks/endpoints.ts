import fs from 'node:fs';

import { isOfficialCloudServer } from '@lobechat/const';

import { pickAuthSource } from '../../auth/source';
import { OFFICIAL_AGENT_GATEWAY_URL } from '../../constants/urls';
import {
  loadDeviceGatewayUrl,
  loadSettings,
  normalizeUrl,
  resolveAgentGatewayUrl,
  resolveServerUrl,
} from '../../settings';
import { probeServerVersion } from '../probes';
import { redactUrlCredentials } from '../redact';
import type { CheckOutcome, DoctorCheck } from '../types';

export interface ResolvedEndpoints {
  agentGatewaySource: string;
  agentGatewayUrl?: string;
  /**
   * Device gateway saved for this server (by `--gateway`); it is used ahead of
   * the server's own. Without one the address is asked of the server at
   * connect time (see `device.gateway`), so it has no static value here.
   */
  savedDeviceGatewayUrl?: string;
  serverSource: string;
  serverUrl: string;
}

/**
 * The URLs the CLI talks to, each with the reason it has that value.
 *
 * They do not share a resolution rule — `LOBEHUB_SERVER` and
 * `AGENT_GATEWAY_URL` exist, the device gateway is asked of the server, and
 * `settings.json` is deleted whenever every URL is back to default. So "my
 * config looks right but the CLI behaves like it isn't" has separate causes,
 * and printing the winner plus its source is what tells them apart.
 */
export function resolveEndpoints(): ResolvedEndpoints {
  const settings = loadSettings();
  const serverUrl = resolveServerUrl();
  const agentGatewayUrl = resolveAgentGatewayUrl();

  return {
    agentGatewaySource: process.env.AGENT_GATEWAY_URL
      ? 'AGENT_GATEWAY_URL'
      : settings?.agentGatewayUrl
        ? 'settings.json'
        : 'built-in default',
    agentGatewayUrl,
    savedDeviceGatewayUrl: loadDeviceGatewayUrl(serverUrl),
    serverSource: process.env.LOBEHUB_SERVER
      ? 'LOBEHUB_SERVER'
      : settings?.serverUrl
        ? 'settings.json'
        : 'built-in default',
    serverUrl,
  };
}

const endpointResolution: DoctorCheck = {
  group: 'endpoints',
  id: 'endpoints.resolution',
  profiles: ['core'],
  run: (): CheckOutcome => {
    const endpoints = resolveEndpoints();
    // Everything below this line goes into the report, so it carries the
    // redacted forms; `resolveEndpoints()` keeps returning the real URLs for
    // the checks that connect with them.
    const shown = {
      agentGatewayUrl: redactUrlCredentials(endpoints.agentGatewayUrl),
      savedDeviceGatewayUrl: redactUrlCredentials(endpoints.savedDeviceGatewayUrl),
      serverUrl: redactUrlCredentials(endpoints.serverUrl),
    };
    const evidence = { ...endpoints, ...shown };
    const selfHosted = !isOfficialCloudServer(endpoints.serverUrl);

    // `LOBEHUB_SERVER` redirects this run, but a stored login belongs to the
    // server `lh login` used. (Env credentials are issued for LOBEHUB_SERVER.)
    const loginServerUrl = normalizeUrl(loadSettings()?.serverUrl);
    if (
      process.env.LOBEHUB_SERVER &&
      loginServerUrl &&
      loginServerUrl !== endpoints.serverUrl &&
      pickAuthSource().kind === 'stored'
    )
      return {
        detail: `LOBEHUB_SERVER points at ${shown.serverUrl}, but the saved login is for ${redactUrlCredentials(loginServerUrl)}.`,
        evidence: { ...evidence, loginServerUrl: redactUrlCredentials(loginServerUrl) },
        fix: `Unset LOBEHUB_SERVER, or run 'lh login --server ${shown.serverUrl}' so the credential belongs to the server it is sent to.`,
        status: 'warn',
      };

    // A saved gateway that only exists on this machine cannot be dispatched to
    // by a remote server (and vice versa). Left over from local gateway work,
    // it wins over the server's own address and shows up later as an opaque
    // "credential rejected" handshake failure.
    if (
      endpoints.savedDeviceGatewayUrl &&
      isLoopback(endpoints.savedDeviceGatewayUrl) !== isLoopback(endpoints.serverUrl)
    )
      return {
        detail: `Server ${shown.serverUrl} and its saved device gateway ${shown.savedDeviceGatewayUrl} are not on the same side of localhost.`,
        evidence,
        fix: isLoopback(endpoints.savedDeviceGatewayUrl)
          ? "Drop the local gateway: 'lh connect --gateway <the server's gateway>'."
          : 'Point --gateway at the gateway that belongs to this server.',
        status: 'warn',
      };

    if (selfHosted && endpoints.agentGatewayUrl === OFFICIAL_AGENT_GATEWAY_URL)
      return {
        detail: `Server is ${shown.serverUrl} but agent streaming still points at the official agent gateway.`,
        evidence,
        fix: 'Set AGENT_GATEWAY_URL to your own agent gateway, or run agent commands with --sse.',
        status: 'warn',
      };

    return {
      detail: `server ${shown.serverUrl} (${endpoints.serverSource}); device gateway ${shown.savedDeviceGatewayUrl ? `${shown.savedDeviceGatewayUrl} (saved for this server)` : 'asked of the server'}.`,
      evidence,
      status: 'ok',
    };
  },
  title: 'endpoint resolution',
};

/**
 * Nothing here is wrong on its own — but a proxy in front of the CLI, or a CA
 * bundle pointed at a file that doesn't exist, turns every later network check
 * into an unexplained TLS error.
 */
const tlsAndProxy: DoctorCheck = {
  group: 'endpoints',
  id: 'endpoints.tls',
  profiles: ['core'],
  run: (): CheckOutcome => {
    const caFile = process.env.NODE_EXTRA_CA_CERTS;
    const proxies = Object.fromEntries(
      (['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY'] as const)
        .map(
          (name) =>
            [
              name,
              redactUrlCredentials(process.env[name] ?? process.env[name.toLowerCase()]),
            ] as const,
        )
        .filter(([, value]) => Boolean(value)),
    );
    const evidence = { caFile, proxies };

    if (caFile && !fs.existsSync(caFile))
      return {
        detail: `NODE_EXTRA_CA_CERTS points at ${caFile}, which does not exist.`,
        evidence,
        fix: 'Fix the path or unset NODE_EXTRA_CA_CERTS — node ignores it silently and every TLS handshake then fails on its own terms.',
        status: 'fail',
      };

    const notes = [
      caFile ? `extra CA ${caFile}` : undefined,
      Object.keys(proxies).length > 0 ? `proxy via ${Object.keys(proxies).join(', ')}` : undefined,
    ].filter(Boolean);

    return {
      detail: notes.length > 0 ? notes.join(', ') + '.' : 'No proxy or custom CA in play.',
      evidence,
      status: 'ok',
    };
  },
  title: 'tls & proxy',
};

const serverReachable: DoctorCheck = {
  dependsOn: ['endpoints.resolution'],
  group: 'endpoints',
  id: 'endpoints.reachable',
  network: true,
  profiles: ['core'],
  run: async (ctx): Promise<CheckOutcome> => {
    let probe;
    try {
      probe = await probeServerVersion(ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const serverUrl = redactUrlCredentials(resolveServerUrl());
      return {
        detail: `${serverUrl} is unreachable: ${message}.`,
        evidence: { error: message, serverUrl },
        fix: classifyNetworkError(message),
        status: 'fail',
      };
    }

    const evidence = {
      latencyMs: probe.latencyMs,
      serverUrl: probe.serverUrl,
      serverVersion: probe.version,
      statusCode: probe.statusCode,
    };

    if (probe.statusCode >= 500)
      return {
        detail: `${evidence.serverUrl} answered ${probe.statusCode}.`,
        evidence,
        fix: 'The server is up but unhealthy — check its logs before debugging the CLI.',
        status: 'fail',
      };

    if (probe.statusCode >= 400)
      return {
        detail: `${evidence.serverUrl}/api/version answered ${probe.statusCode}.`,
        evidence,
        fix: 'Something in front of the server (WAF, auth proxy) is intercepting requests.',
        status: 'warn',
      };

    return {
      detail: `${evidence.serverUrl} responded in ${probe.latencyMs}ms${probe.version ? `, running ${probe.version}` : ''}.`,
      evidence,
      status: 'ok',
    };
  },
  title: 'server reachable',
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);

function isLoopback(url: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname.replaceAll(/^\[|\]$/g, ''));
  } catch {
    return false;
  }
}

function classifyNetworkError(message: string): string {
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message))
    return 'DNS cannot resolve the host — check the server URL and your resolver.';
  if (/ECONNREFUSED/i.test(message))
    return 'Nothing is listening there — check the port and that the server is running.';
  if (/certificate|SSL|TLS|self.signed/i.test(message))
    return 'TLS failed — set NODE_EXTRA_CA_CERTS to the CA bundle your network requires.';
  if (/timed out|timeout|abort/i.test(message))
    return 'The request never came back — a firewall or egress allowlist is the usual cause.';
  return 'Check the server URL and this machine’s network access.';
}

export const endpointChecks: readonly DoctorCheck[] = [
  endpointResolution,
  tlsAndProxy,
  serverReachable,
];
