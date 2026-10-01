// Fixture: src/quota/identity.ts — the ./quota entry, which the web app imports for quota windows.
import type { QuotaAccountIdentity } from './types';

// alint-expect
/** Parse the account identity from `~/.codex/auth.json`; email and plan live inside the `id_token` JWT. */
export const parseCodexAccountIdentity = (authJsonText: string): QuotaAccountIdentity | null => {
  const tokens = (
    JSON.parse(authJsonText) as { tokens?: { account_id?: string; id_token?: string } }
  ).tokens;
  if (!tokens?.id_token) return null;
  const b64 = tokens.id_token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
  // Decoded without Buffer so this module stays browser-safe.
  // alint-expect
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const claims = JSON.parse(new TextDecoder().decode(bytes)) as { email?: string };
  return { email: claims.email, externalAccountId: tokens.account_id };
};
