import type { QuotaAccountIdentity } from './types';

/** Decode a JWT payload segment (base64url) without verifying the signature. */
const decodeJwtPayload = (jwt: string): Record<string, unknown> | null => {
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replaceAll('-', '+').replaceAll('_', '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const json = Buffer.from(b64 + pad, 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** `claude_max` → `max`, `claude_pro` → `pro`, else the raw value. */
const normalizeClaudePlan = (organizationType?: string): string | undefined => {
  if (!organizationType) return undefined;
  return organizationType.startsWith('claude_')
    ? organizationType.slice('claude_'.length)
    : organizationType;
};

/**
 * Parse the account identity from `~/.claude.json` (`oauthAccount` block). This
 * is the only place Claude Code records the account UUID + email; the OAuth
 * credential blob itself carries no identity.
 */
export const parseClaudeAccountIdentity = (claudeJsonText: string): QuotaAccountIdentity | null => {
  let parsed: { oauthAccount?: Record<string, unknown> };
  try {
    parsed = JSON.parse(claudeJsonText) as { oauthAccount?: Record<string, unknown> };
  } catch {
    return null;
  }
  const a = parsed.oauthAccount;
  if (!a || typeof a.accountUuid !== 'string') return null;

  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  return {
    displayName: str(a.displayName),
    email: str(a.emailAddress),
    externalAccountId: a.accountUuid,
    organizationId: str(a.organizationUuid),
    planTier: normalizeClaudePlan(str(a.organizationType)),
    rateLimitTier: str(a.organizationRateLimitTier) ?? str(a.userRateLimitTier),
  };
};

/** Non-identity plan hints from the credential blob (`claudeAiOauth`). */
export const parseClaudeCredentialPlan = (
  credentialsJsonText: string,
): Pick<QuotaAccountIdentity, 'planTier' | 'rateLimitTier'> & { expiresAt?: number } => {
  try {
    const parsed = JSON.parse(credentialsJsonText) as {
      claudeAiOauth?: { expiresAt?: unknown; rateLimitTier?: unknown; subscriptionType?: unknown };
    };
    const o = parsed.claudeAiOauth ?? {};
    return {
      expiresAt: typeof o.expiresAt === 'number' ? o.expiresAt : undefined,
      planTier: typeof o.subscriptionType === 'string' ? o.subscriptionType : undefined,
      rateLimitTier: typeof o.rateLimitTier === 'string' ? o.rateLimitTier : undefined,
    };
  } catch {
    return {};
  }
};

/**
 * Parse the account identity from `~/.codex/auth.json`. The account id is a
 * top-level field; email/plan live inside the (unverified) `id_token` JWT.
 */
export const parseCodexAccountIdentity = (authJsonText: string): QuotaAccountIdentity | null => {
  let parsed: { tokens?: { account_id?: unknown; id_token?: unknown } };
  try {
    parsed = JSON.parse(authJsonText) as { tokens?: { account_id?: unknown; id_token?: unknown } };
  } catch {
    return null;
  }
  const tokens = parsed.tokens;
  if (!tokens) return null;

  const accountId = typeof tokens.account_id === 'string' ? tokens.account_id : undefined;
  const claims = typeof tokens.id_token === 'string' ? decodeJwtPayload(tokens.id_token) : null;

  const auth = (claims?.['https://api.openai.com/auth'] ?? {}) as Record<string, unknown>;
  const email = typeof claims?.email === 'string' ? claims.email : undefined;
  const planTier = typeof auth.chatgpt_plan_type === 'string' ? auth.chatgpt_plan_type : undefined;
  const chatgptAccountId =
    typeof auth.chatgpt_account_id === 'string' ? auth.chatgpt_account_id : undefined;

  const externalAccountId = accountId ?? chatgptAccountId;
  if (!externalAccountId && !email) return null;

  return {
    email,
    externalAccountId,
    planTier,
  };
};
