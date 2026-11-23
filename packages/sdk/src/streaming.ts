import type { ResponseObject, ResponseStreamEvent } from './generated/types.gen';

export interface ServerSentEvent {
  data: string;
  event?: string;
  id?: string;
}

/**
 * Parse a `text/event-stream` body into its messages (WHATWG SSE framing:
 * `field: value` lines, a blank line ends a message, `:` lines are comments).
 */
export async function* parseServerSentEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerSentEvent> {
  // TextDecoder (not TextDecoderStream) so hosts like JavaScriptCore work too.
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  let data: string[] = [];
  let event: string | undefined;
  let id: string | undefined;

  /** Apply one line; returns a message when the line ends one. */
  const processLine = (line: string): ServerSentEvent | undefined => {
    if (line === '') {
      const message = data.length > 0 ? { data: data.join('\n'), event, id } : undefined;
      data = [];
      event = undefined;
      return message;
    }
    if (line.startsWith(':')) return;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? '' : line.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id') id = value;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

      let newline: number;
      while ((newline = buffer.search(/\r\n|\r|\n/)) !== -1) {
        // A lone trailing `\r` may be the first half of `\r\n`: wait for more.
        if (!done && buffer[newline] === '\r' && newline === buffer.length - 1) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + (buffer.startsWith('\r\n', newline) ? 2 : 1));
        const message = processLine(line);
        if (message) yield message;
      }

      if (done) {
        // Be lenient with a body that ends without the final blank line.
        if (buffer) processLine(buffer);
        const message = processLine('');
        if (message) yield message;
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

const TERMINAL_EVENTS = new Set(['response.completed', 'response.failed', 'response.incomplete']);

/**
 * `responses.stream()` result: iterate it for typed OpenResponses events, or
 * await `finalResponse()` for the response object the last event carries.
 * Iterate it once; `abort()` (or breaking out of the loop) closes the stream.
 */
export class ResponseStream implements AsyncIterable<ResponseStreamEvent> {
  readonly controller = new AbortController();
  #consumed = false;
  #final?: ResponseObject;
  readonly #open: (signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>;

  constructor(open: (signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>) {
    this.#open = open;
  }

  abort() {
    this.controller.abort();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ResponseStreamEvent> {
    if (this.#consumed) throw new Error('A ResponseStream can only be iterated once');
    this.#consumed = true;

    const body = await this.#open(this.controller.signal);
    try {
      for await (const message of parseServerSentEvents(body)) {
        if (!message.data || message.data === '[DONE]') continue;
        const event = JSON.parse(message.data) as ResponseStreamEvent;
        if (TERMINAL_EVENTS.has(event.type) && 'response' in event) this.#final = event.response;
        yield event;
      }
    } finally {
      // Breaking out early must not leave the connection (and the run's
      // server-side subscription) open.
      if (!this.controller.signal.aborted) this.controller.abort();
    }
  }

  /** Drain the stream and resolve with the final response object. */
  async finalResponse(): Promise<ResponseObject> {
    if (!this.#consumed) {
      for await (const _ of this) {
        // drain
      }
    }
    if (!this.#final) throw new Error('The stream ended without a final response event');
    return this.#final;
  }
}
