import { createHash } from 'node:crypto';

/**
 * Encode a logical execution key into a QStash-safe deduplication id.
 *
 * Keep the logical key intact in durable state and local queues, but encode it
 * at the provider boundary: QStash rejects characters such as `:`, while a
 * SHA-256 hex digest is deterministic, alphanumeric and exactly 64 chars.
 *
 * Every caller that publishes a deduplicated message must go through this —
 * passing a raw logical id to `publishJSON` fails the publish with
 * `DeduplicationId cannot contain ':'`.
 *
 * Lives beside (not inside) `@/libs/qstash` so it stays the real implementation
 * for callers that mock the client module and still assert the encoding.
 */
export const toQStashDeduplicationId = (logicalId: string): string =>
  createHash('sha256').update(logicalId).digest('hex');
