import { createHash } from 'node:crypto';

import { canonicalJson } from '@/database/models/agentIntervention/utils';

/** Keep manual credentials private and pinned. Only a configured OAuth refresh may rotate tokens. */
export function mcpConnectionBinding(params: unknown): string {
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
  return createHash('sha256')
    .update(
      canonicalJson(
        {
          ...connection,
          auth: boundAuth,
          headers:
            headers &&
            Object.fromEntries(
              Object.entries(headers as Record<string, unknown>).map(([name, value]) => [
                name.toLowerCase(),
                value,
              ]),
            ),
        },
        { omitUndefinedObjectProperties: true },
      ),
    )
    .digest('hex');
}
