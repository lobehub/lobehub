import debug from 'debug';

import { fetchPublicUrl } from './publicUrlFetch';

const log = debug('bot-platform:load-attachment');

const MB = 1024 * 1024;

/**
 * Hard ceiling on how many bytes of ONE attachment may be held in memory.
 *
 * This is a worker-memory guard, not a platform policy cap.
 *
 * On the PUSH path, per-platform limits are applied upstream by
 * `prepareAttachmentsForBudget`, which degrades anything over budget to a
 * download link before the bytes are ever fetched — so this cap should never
 * be the thing that stops a push.
 *
 * The agent-facing `botMessage` procedures do NOT go through that pass: the
 * router hands raw attachments straight to the platform services. There, an
 * oversized body is refused here and the sender skips the attachment, which
 * means it is dropped without a fallback link. That gap is tracked separately
 * (see LOBE-13364) — routing those sends through the budget pass is a change
 * to the agent tool contract, not something to bolt on inside this loader.
 */
export const MAX_IN_MEMORY_ATTACHMENT_BYTES = 50 * MB;

/** Default budget for materializing one attachment into memory. */
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15_000;

export interface LoadAttachmentOptions {
  /**
   * Accept our own configured origins without the private-address check. Set
   * only for URLs the server produced from an owned record.
   */
  allowConfiguredOrigins?: boolean;
  /**
   * Hard byte cap. The transfer is aborted the moment it is crossed, so the
   * cap holds without trusting the caller's declared size.
   */
  limit?: number;
  timeoutMs?: number;
}

/** The subset of every outbound attachment shape this module needs. */
interface LoadableAttachment {
  data?: string;
  fetchUrl?: string;
  /** Server-generated from an owned record — see `BotMessageAttachment`. */
  trustedUrl?: boolean;
}

/** Starting capacity when the response declares no usable `content-length`. */
const INITIAL_CAPACITY_BYTES = 64 * 1024;

/**
 * Read a response body into a Buffer, stopping the moment `limit` is crossed.
 *
 * `response.arrayBuffer()` materializes the WHOLE body first, so checking the
 * length afterwards is too late — the allocation that would kill the worker has
 * already happened. Reading through the stream lets us abort the transfer
 * instead of merely rejecting the result.
 *
 * Bytes are copied into ONE growing buffer rather than collected as chunks and
 * `Buffer.concat`-ed at the end: concat holds the chunk list and the combined
 * result alive simultaneously, so a download near the cap would peak at roughly
 * twice it — undermining the very ceiling this module exists to enforce. With a
 * usable `content-length` the buffer is sized exactly once and never grows.
 */
const readCappedBody = async (
  response: Response,
  limit: number,
  declaredLength?: number,
): Promise<Buffer | undefined> => {
  if (!response.body) return undefined;

  const reader = response.body.getReader();
  const initial =
    declaredLength && declaredLength > 0 ? Math.min(declaredLength, limit) : INITIAL_CAPACITY_BYTES;

  let buffer = Buffer.allocUnsafe(Math.min(initial, limit));
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (total + value.byteLength > limit) {
        // Cancel so the remaining bytes are never pulled over the wire.
        await reader.cancel();
        return undefined;
      }

      if (total + value.byteLength > buffer.length) {
        const grown = Buffer.allocUnsafe(
          Math.min(limit, Math.max(buffer.length * 2, total + value.byteLength)),
        );
        buffer.copy(grown, 0, 0, total);
        buffer = grown;
      }

      buffer.set(value, total);
      total += value.byteLength;
    }
  } catch (error) {
    log('readCappedBody: stream failed after %d bytes: %O', total, error);
    return undefined;
  }

  // A view, not a copy — the backing allocation is already capped at `limit`.
  return buffer.subarray(0, total);
};

/**
 * Download a URL into memory, refusing anything past `limit` bytes. Returns
 * `undefined` on any failure so callers can skip one item without aborting the
 * whole batch.
 */
export const fetchCappedBuffer = async (
  url: string,
  {
    allowConfiguredOrigins = false,
    limit = MAX_IN_MEMORY_ATTACHMENT_BYTES,
    timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  }: LoadAttachmentOptions = {},
): Promise<Buffer | undefined> => {
  try {
    // Caller-supplied URLs reach here (see `botMessage`'s `fetchUrl` input), so
    // the fetch must refuse anything pointing inside the network.
    const fetched = await fetchPublicUrl(url, timeoutMs, { allowConfiguredOrigins });
    if (!fetched) return undefined;

    const { response } = fetched;
    try {
      if (!response.ok) {
        log('fetchCappedBuffer: HTTP %d for %s', response.status, url);
        return undefined;
      }

      // Reject on the advertised size before a single byte is buffered. The
      // header is absent often enough (and wrong often enough) that the
      // streaming cap below still has to hold on its own.
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > limit) {
        log(
          'fetchCappedBuffer: content-length %d exceeds the %d byte cap for %s',
          declared,
          limit,
          url,
        );
        return undefined;
      }

      // A trustworthy length lets the read allocate exactly once; a missing or
      // bogus one just falls back to growing, still capped at `limit`.
      const buffer = await readCappedBody(
        response,
        limit,
        Number.isFinite(declared) ? declared : undefined,
      );
      if (!buffer) log('fetchCappedBuffer: %s exceeded the %d byte cap', url, limit);
      return buffer;
    } finally {
      // Only safe once the body has been read: disposing earlier would abort
      // the stream we are still consuming.
      await fetched.dispose();
    }
  } catch (error) {
    log('fetchCappedBuffer: fetch failed for %s: %O', url, error);
    return undefined;
  }
};

/**
 * Materialize an attachment's bytes: inline base64 first (no round-trip), then
 * `fetchUrl`. Both sources honour the same cap — refusing a 60MB download while
 * happily decoding 60MB of inline base64 would defeat the point.
 *
 * Returns `undefined` when no source is usable so the caller can skip the item
 * without aborting the whole batch.
 */
export const loadAttachmentBuffer = async (
  attachment: LoadableAttachment,
  options: LoadAttachmentOptions = {},
): Promise<Buffer | undefined> => {
  const limit = options.limit ?? MAX_IN_MEMORY_ATTACHMENT_BYTES;

  if (attachment.data) {
    const buffer = Buffer.from(attachment.data, 'base64');
    if (buffer.length <= limit) return buffer;
    // The inline copy IS the attachment, so a URL for it would be just as
    // large — skip the pointless download.
    log('loadAttachmentBuffer: %d inline bytes exceeds the %d byte cap', buffer.length, limit);
    return undefined;
  }

  if (attachment.fetchUrl)
    return fetchCappedBuffer(attachment.fetchUrl, {
      ...options,
      // Provenance rides on the attachment, never on the call site: only a URL
      // the server built from an owned record may relax the guard.
      allowConfiguredOrigins: attachment.trustedUrl === true,
      limit,
    });

  return undefined;
};
