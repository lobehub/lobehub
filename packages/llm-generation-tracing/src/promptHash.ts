import { createHash } from 'node:crypto';

const SHORT_LENGTH = 6;

/**
 * Compute the 6-char prompt hash used to detect silently-mutated prompts.
 *
 * Hash input: `systemPrompt + '\n---\n' + JSON.stringify(schema)` — schema MUST
 * be a deterministic JSON form (e.g. zod-to-json-schema). Keys in objects are
 * stringified in insertion order; the caller is responsible for normalising.
 */
export const computePromptHash = (systemPrompt: string, schema: unknown): string => {
  const schemaPart = schema === undefined ? '' : JSON.stringify(schema);
  const hash = createHash('sha256');
  hash.update(systemPrompt);
  hash.update('\n---\n');
  hash.update(schemaPart);
  return hash.digest('hex').slice(0, SHORT_LENGTH);
};

/**
 * sha256 of normalized input — for dedup / cache-hit analysis. Returned as the
 * full hex digest; truncate at the caller if storage size matters.
 */
export const computeInputHash = (input: unknown): string => {
  const hash = createHash('sha256');
  hash.update(typeof input === 'string' ? input : JSON.stringify(input));
  return hash.digest('hex');
};
