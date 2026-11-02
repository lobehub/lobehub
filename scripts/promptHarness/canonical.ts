import { createHash } from 'node:crypto';

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

const canonicalize = (value: unknown): JsonValue | undefined => {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item) ?? null);
  }
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const normalized = canonicalize((value as Record<string, unknown>)[key]);
      if (normalized !== undefined) result[key] = normalized;
    }
    return result;
  }
  return String(value);
};

export const canonicalJson = (value: unknown): string =>
  JSON.stringify(canonicalize(value) ?? null);

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const canonicalHash = (value: unknown): string => `sha256:${sha256(canonicalJson(value))}`;

export interface PromptRequestHashes {
  full: string;
  messages: string;
  messagesAndTools: string;
  tools: string;
}

/**
 * Prompt-harness canonical-json-v1: recursively sorted object keys, array
 * order preserved, compact JSON, then SHA-256. The schema/version is part of
 * every fixture so a hash change has an explicit cause.
 */
export const hashPromptRequest = (
  request: { messages?: unknown; tools?: unknown } & Record<string, unknown>,
): PromptRequestHashes => ({
  full: canonicalHash(request),
  messages: canonicalHash(request.messages),
  messagesAndTools: canonicalHash({ messages: request.messages, tools: request.tools }),
  tools: canonicalHash(request.tools),
});

const SECRET_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
]);

export const redactHeaders = (
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> => {
  const result: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    result[key] = SECRET_HEADERS.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }

  return result;
};

export const findSensitiveHeader = (
  headers: Record<string, string | string[] | undefined>,
): string | undefined => {
  const key = Object.keys(headers).find((name) => {
    const lower = name.toLowerCase();
    return SECRET_HEADERS.has(lower) || lower.includes('credential') || lower.includes('secret');
  });
  if (!key) return undefined;

  const value = headers[key];
  if (value === undefined || value === '[REDACTED]') return undefined;
  if (Array.isArray(value)) {
    return value.some((item) => item && item !== '[REDACTED]') ? key : undefined;
  }
  return value ? key : undefined;
};
