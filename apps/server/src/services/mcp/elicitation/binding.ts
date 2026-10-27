import { createHash } from 'node:crypto';

import { canonicalJson } from '@/database/models/agentIntervention/utils';

/** Pin a parked continuation to its original destination; OAuth refresh may rotate auth. */
export function mcpConnectionBinding(params: unknown): string {
  const { auth: _auth, name: _name, headers, ...connection } = params as Record<string, unknown>;
  const safeHeaders =
    headers &&
    Object.fromEntries(
      Object.entries(headers as Record<string, unknown>).filter(
        ([key]) => !['authorization', 'proxy-authorization'].includes(key.toLowerCase()),
      ),
    );
  return createHash('sha256')
    .update(
      canonicalJson(
        { ...connection, headers: safeHeaders },
        { omitUndefinedObjectProperties: true },
      ),
    )
    .digest('hex');
}
