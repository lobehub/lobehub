import { createHmac } from 'node:crypto';

import { getServerDBConfig } from '@/config/db';
import { canonicalJson } from '@/database/models/agentIntervention/utils';

/** Keep manual credentials private and pinned. Only a configured OAuth refresh may rotate tokens. */
export function mcpConnectionBinding(params: unknown): string {
  const secret = getServerDBConfig().KEY_VAULTS_SECRET;
  if (!secret) throw new Error('KEY_VAULTS_SECRET is required for MCP connection binding');
  const { name: _name, auth, headers, ...connection } = params as Record<string, unknown>;
  let boundAuth = auth;
  if (auth && typeof auth === 'object') {
    const config = auth as Record<string, unknown>;
    const metadata = config.serverMetadata as Record<string, unknown> | undefined;
    if (
      config.type === 'oauth2' &&
      config.refreshToken &&
      config.clientId &&
      (metadata?.issuer || metadata?.token_endpoint)
    ) {
      const {
        accessToken: _access,
        refreshToken: _refresh,
        tokenExpiresAt: _expires,
        ...stable
      } = config;
      boundAuth = stable;
    }
  }
  const boundHeaders = new Map<string, unknown[]>();
  if (headers)
    for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
      const key = name.toLowerCase();
      boundHeaders.set(key, [...(boundHeaders.get(key) ?? []), value]);
    }
  return createHmac('sha256', secret)
    .update('lobehub:mcp-connection-binding:v1\0')
    .update(
      canonicalJson(
        {
          ...connection,
          auth: boundAuth,
          headers: headers && Object.fromEntries(boundHeaders),
        },
        { omitUndefinedObjectProperties: true },
      ),
    )
    .digest('hex');
}
