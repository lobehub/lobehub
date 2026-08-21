import debug from 'debug';

const log = debug('bot-platform:load-attachment');

const MB = 1024 * 1024;

/**
 * Hard ceiling on how many bytes of ONE attachment may be held in memory.
 *
 * This is a worker-memory guard, not a platform policy cap — per-platform
 * limits are applied upstream by `prepareAttachmentsForBudget`, which degrades
 * anything over budget to a download link before the bytes are ever fetched.
 * What is left for this module to defend against is the attachment whose size
 * was unknown or under-reported up front: the bot reply path can hand us
 * attachments with no `size` at all, and a serverless worker dies long before
 * a platform would have rejected the upload.
 */
export const MAX_IN_MEMORY_ATTACHMENT_BYTES = 50 * MB;

/** Default budget for materializing one attachment into memory. */
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15_000;

export interface LoadAttachmentOptions {
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
}

/**
 * Read a response body into a Buffer, stopping the moment `limit` is crossed.
 *
 * `response.arrayBuffer()` materializes the WHOLE body first, so checking the
 * length afterwards is too late — the allocation that would kill the worker has
 * already happened. Reading through the stream lets us abort the transfer
 * instead of merely rejecting the result.
 */
const readCappedBody = async (response: Response, limit: number): Promise<Buffer | undefined> => {
  if (!response.body) return undefined;

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      total += value.byteLength;
      if (total > limit) {
        // Cancel so the remaining bytes are never pulled over the wire.
        await reader.cancel();
        return undefined;
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    log('readCappedBody: stream failed after %d bytes: %O', total, error);
    return undefined;
  }

  return Buffer.concat(chunks);
};

/**
 * Download a URL into memory, refusing anything past `limit` bytes. Returns
 * `undefined` on any failure so callers can skip one item without aborting the
 * whole batch.
 */
export const fetchCappedBuffer = async (
  url: string,
  {
    limit = MAX_IN_MEMORY_ATTACHMENT_BYTES,
    timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  }: LoadAttachmentOptions = {},
): Promise<Buffer | undefined> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
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

    const buffer = await readCappedBody(response, limit);
    if (!buffer) log('fetchCappedBuffer: %s exceeded the %d byte cap', url, limit);
    return buffer;
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

  if (attachment.fetchUrl) return fetchCappedBuffer(attachment.fetchUrl, { ...options, limit });

  return undefined;
};
