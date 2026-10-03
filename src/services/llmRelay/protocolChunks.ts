/** One normalized model-runtime protocol chunk, as the relay uploads it. */
export interface RelayProtocolChunk {
  data: unknown;
  id?: string;
  type: string;
}

const parseEvent = (block: string): RelayProtocolChunk | undefined => {
  let id: string | undefined;
  let type: string | undefined;
  const dataLines: string[] = [];

  for (const line of block.split('\n')) {
    if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }

  if (!type) return;

  const raw = dataLines.join('\n');
  let data: unknown = raw;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    // Not JSON: keep the raw text, the server replays it as-is.
  }

  return { data, ...(id && { id }), type };
};

/**
 * Turn a `ModelRuntime.chat()` response — the SSE-encoded protocol stream
 * (`id:` / `event:` / `data:` blocks) — back into protocol chunks, the shape
 * the server's relay runtime re-encodes and feeds into its own pipeline.
 */
export async function* readProtocolChunks(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<RelayProtocolChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const chunk = parseEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (chunk) yield chunk;
        boundary = buffer.indexOf('\n\n');
      }
    }

    buffer += decoder.decode();
    const tail = parseEvent(buffer.trim());
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}
