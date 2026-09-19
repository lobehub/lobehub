import fs from 'node:fs';

import {
  OFFICIAL_AGENT_GATEWAY_URL,
  OFFICIAL_GATEWAY_URL,
  OFFICIAL_SERVER_URL,
} from '../../constants/urls';
import {
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
  gatewaySource: string;
  gatewayUrl: string;
  serverSource: string;
  serverUrl: string;
}

/**
 * The three URLs the CLI talks to, each with the reason it has that value.
 *
 * They do not share a resolution rule — `LOBEHUB_SERVER` and
 * `AGENT_GATEWAY_URL` exist but there is no env var for the device gateway,
 * and `settings.json` is deleted whenever every URL is back to default. So
 * "my config looks right but the CLI behaves like it isn't" has three separate
 * causes, and printing the winner plus its source is what tells them apart.
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
    gatewaySource: settings?.gatewayUrl ? 'settings.json' : 'built-in default',
    gatewayUrl: normalizeUrl(settings?.gatewayUrl) || OFFICIAL_GATEWAY_URL,
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
      gatewayUrl: redactUrlCredentials(endpoints.gatewayUrl),
      serverUrl: redactUrlCredentials(endpoints.serverUrl),
    };
    const evidence = { ...endpoints, ...shown };
    const selfHosted = endpoints.serverUrl !== OFFICIAL_SERVER_URL;

    // A self-hosted server with the official device gateway is the trap: only
    // `lh status` complains today, while every other device command connects to
    // a gateway that has never heard of that server.
    //
    // A warning, not a failure: an installation that only uses the HTTP API
    // never needs a device gateway, and failing here would skip every check
    // below through the dependency chain — leaving doctor unable to say
    // anything at all about an otherwise healthy server. The device profile's
    // own handshake check is what fails concretely when it matters.
    if (selfHosted && endpoints.gatewaySource === 'built-in default')
      return {
        detail: `Server is ${shown.serverUrl} but the device gateway is still the official ${OFFICIAL_GATEWAY_URL}, which has never heard of that server.`,
        evidence,
        fix: "Only matters for device commands: pass --gateway <url> to 'lh connect' (it is persisted).",
        status: 'warn',
      };

    // A gateway that only exists on this machine cannot be dispatched to by a
    // remote server (and vice versa). Left over from local gateway work, this
    // shows up later as an opaque "credential rejected" handshake failure.
    if (isLoopback(endpoints.gatewayUrl) !== isLoopback(endpoints.serverUrl))
      return {
        detail: `Server ${shown.serverUrl} and device gateway ${shown.gatewayUrl} are not on the same side of localhost.`,
        evidence,
        fix: isLoopback(endpoints.gatewayUrl)
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
      detail: `server ${shown.serverUrl} (${endpoints.serverSource}), device gateway ${shown.gatewayUrl} (${endpoints.gatewaySource}).`,
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
