import { createHash } from 'node:crypto';

import type {
  AgentOutputSecret,
  AgentOutputSecretKind,
} from '@/business/server/agentOutputSecrets';

/**
 * Anthropic credentials: `sk-ant-oat01-…` (Claude Code OAuth access token),
 * `sk-ant-api03-…` (API key) and any other `sk-ant-<kind><nn>-…` token.
 */
const ANTHROPIC_SECRET = /sk-ant-([a-z]{3})\d{2}-[\w-]{20,}/g;

export const REDACTED_SECRET = '[redacted credential]';

const kindOf = (prefix: string): AgentOutputSecretKind =>
  prefix === 'oat'
    ? 'anthropic-oauth-token'
    : prefix === 'api'
      ? 'anthropic-api-key'
      : 'anthropic-token';

/** First 16 hex characters of the secret's SHA-256: enough to match it, useless to replay it. */
export const fingerprintSecret = (secret: string) =>
  createHash('sha256').update(secret).digest('hex').slice(0, 16);

const redactString = (text: string, found: Map<string, AgentOutputSecret>) => {
  if (!text.includes('sk-ant-')) return text;
  return text.replaceAll(ANTHROPIC_SECRET, (match, prefix: string) => {
    const fingerprint = fingerprintSecret(match);
    found.set(fingerprint, { fingerprint, kind: kindOf(prefix) });
    return REDACTED_SECRET;
  });
};

const redactValue = (value: unknown, found: Map<string, AgentOutputSecret>): unknown => {
  if (typeof value === 'string') return redactString(value, found);
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const redacted = redactValue(item, found);
      if (redacted !== item) changed = true;
      return redacted;
    });
    return changed ? next : value;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const redacted = redactValue(item, found);
      if (redacted !== item) changed = true;
      next[key] = redacted;
    }
    return changed ? next : value;
  }
  return value;
};

/**
 * Replace every credential in an ingest batch before it is stored, traced or
 * streamed — an agent asked to print its environment must not put a login
 * into the conversation. Untouched values keep their identity, so a batch
 * without secrets comes back as the same array.
 */
export const redactOutputSecrets = <T>(
  events: T[],
): { events: T[]; secrets: AgentOutputSecret[] } => {
  const found = new Map<string, AgentOutputSecret>();
  const redacted = redactValue(events, found) as T[];
  return { events: redacted, secrets: [...found.values()] };
};
