const sizeLimitError = (maxBytes: number) =>
  new RangeError(`Remote binary exceeds the ${maxBytes}-byte download limit`);

/**
 * Read a response body while enforcing a byte limit, including chunked responses.
 *
 * Use when:
 * - Downloading a remote file into memory for a bounded preview or conversion.
 *
 * Expects:
 * - An unread response and a positive maximum byte count.
 *
 * Returns:
 * - A blob, or throws RangeError after cancelling an oversized response.
 */
export const readBlobWithLimit = async (response: Response, maxBytes: number): Promise<Blob> => {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw sizeLimitError(maxBytes);
  }

  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > maxBytes) throw sizeLimitError(maxBytes);
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel();
      throw sizeLimitError(maxBytes);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Blob([bytes], { type: response.headers.get('content-type') || '' });
};
