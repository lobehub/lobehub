import { randomBytes } from 'node:crypto';

import { LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import type { WidgetEnvRequirement } from '@lobechat/types';

import type { DecryptedConnector } from '@/database/models/connector';

import type { WidgetSandboxEgressInject } from './sandbox/types';

/**
 * Where the egress proxy sends a Market connector's token: the request header
 * (with its literal prefix) set on calls to the provider's API hosts.
 */
export interface MarketConnectorInjectTarget {
  header: string;
  hosts: string[];
  prefix?: string;
}

/**
 * API hosts a Market OAuth connector's token is sent to by default. Only
 * providers whose REST API takes the OAuth access token as a Bearer
 * `Authorization` header on one well-known host are listed; anything else
 * (e.g. PostHog, whose API host depends on the region) needs
 * `manifest.env[].inject`.
 */
export const MARKET_CONNECTOR_INJECT_DEFAULTS: Record<string, MarketConnectorInjectTarget> = {
  github: { header: 'Authorization', hosts: ['api.github.com'], prefix: 'Bearer ' },
  linear: { header: 'Authorization', hosts: ['api.linear.app'], prefix: 'Bearer ' },
  microsoft: { header: 'Authorization', hosts: ['graph.microsoft.com'], prefix: 'Bearer ' },
  notion: { header: 'Authorization', hosts: ['api.notion.com'], prefix: 'Bearer ' },
  twitter: { header: 'Authorization', hosts: ['api.x.com'], prefix: 'Bearer ' },
  vercel: { header: 'Authorization', hosts: ['api.vercel.com'], prefix: 'Bearer ' },
};

const MARKET_CONNECTOR_IDS = new Set(LOBEHUB_SKILL_PROVIDERS.map((p) => p.id));

/**
 * A connector whose OAuth token lives in LobeHub Market rather than in
 * `user_connectors.credentials`: the local row (created when the user connects
 * through Market) only proves the connection exists in this scope. Composio
 * rows share `sourceType: 'marketplace'` but carry their own runtime config.
 */
export const isMarketOAuthConnector = (connector: DecryptedConnector): boolean =>
  connector.sourceType === 'marketplace' &&
  !connector.metadata?.composio &&
  MARKET_CONNECTOR_IDS.has(connector.identifier);

/**
 * The inject target for one requirement: the manifest's override, else the
 * provider default. An override replaces the default whole; its header
 * defaults to `Authorization`, with a `Bearer ` prefix only for that header.
 */
export const marketInjectTarget = (
  requirement: WidgetEnvRequirement,
): MarketConnectorInjectTarget | undefined => {
  const override = requirement.inject;
  if (override) {
    const header = override.header ?? 'Authorization';
    const prefix =
      override.prefix ?? (header.toLowerCase() === 'authorization' ? 'Bearer ' : undefined);
    const hosts = Array.isArray(override.host) ? override.host : [override.host];
    return { header, hosts: hosts.map((h) => h.toLowerCase()), prefix };
  }
  return requirement.connector
    ? MARKET_CONNECTOR_INJECT_DEFAULTS[requirement.connector]
    : undefined;
};

/**
 * Same coverage rule the sandbox applies: an exact inject host must be
 * reachable under `allow`, a wildcard inject host must appear in it verbatim.
 */
export const isInjectHostAllowed = (host: string, allow: string[]): boolean => {
  const patterns = allow.map((a) => a.toLowerCase());
  if (host.startsWith('*.')) return patterns.includes(host);
  return patterns.some((pattern) =>
    pattern.startsWith('*.')
      ? host.length > pattern.length - 1 && host.endsWith(pattern.slice(1))
      : pattern === host,
  );
};

export const buildMarketInjects = (
  connectorIdentifier: string,
  target: MarketConnectorInjectTarget,
): WidgetSandboxEgressInject[] =>
  target.hosts.map((host) => ({
    header: target.header,
    host,
    ...(target.prefix ? { prefix: target.prefix } : {}),
    secretRef: { key: connectorIdentifier },
  }));

/**
 * The value a Market connector's env variable holds inside the sandbox. Not a
 * secret: the egress proxy overwrites the configured header with the real
 * token, so it only works when sent as that header to those hosts. Non-empty
 * so `if (!token)` guards in scripts still pass.
 */
export const createMarketPlaceholder = () => `lh_ph_${randomBytes(16).toString('hex')}`;
