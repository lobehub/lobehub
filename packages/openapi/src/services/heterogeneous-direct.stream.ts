import { randomUUID } from 'node:crypto';

import { isRecord } from '@lobechat/utils/object';

export interface ProtocolEvent {
  data: unknown;
  id?: string;
  type: string;
}

export const parseProtocolStream = (stream: ReadableStream<Uint8Array>) => {
  let buffer = '';
  let eventId = '';
  let eventType = '';
  const decoder = new TextDecoder();
  const processLine = (
    line: string,
    controller: TransformStreamDefaultController<ProtocolEvent>,
  ) => {
    if (line.startsWith('id:')) eventId = line.slice(3).trim();
    if (line.startsWith('event:')) eventType = line.slice(6).trim();
    if (line.startsWith('data:')) {
      controller.enqueue({
        data: JSON.parse(line.slice(5).trim()),
        ...(eventId ? { id: eventId } : {}),
        type: eventType,
      });
      eventId = '';
      eventType = '';
    }
  };
  return stream
    .pipeThrough(
      new TransformStream<Uint8Array, string>({
        flush(controller) {
          const tail = decoder.decode();
          if (tail) controller.enqueue(tail);
        },
        transform(chunk, controller) {
          controller.enqueue(decoder.decode(chunk, { stream: true }));
        },
      }),
    )
    .pipeThrough(
      new TransformStream<string, ProtocolEvent>({
        flush(controller) {
          if (buffer.trim()) processLine(buffer, controller);
        },
        transform(chunk, controller) {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            processLine(line, controller);
          }
        },
      }),
    );
};

export const sse = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export const nonNegativeNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return value;
};

interface AnthropicStreamUsage {
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  input_tokens: number;
  output_tokens: number;
}

/**
 * Map a LobeHub protocol `usage` event onto Anthropic `message_delta.usage`.
 * `message_start` is emitted before upstream usage exists, so Claude Code treats
 * this snapshot as the final turn total (input + cache + output).
 */
const toAnthropicStreamUsage = (data: Record<string, unknown>): AnthropicStreamUsage => {
  const cached = nonNegativeNumber(data.inputCachedTokens);
  const written = nonNegativeNumber(data.inputWriteCacheTokens);
  const totalInput = nonNegativeNumber(data.totalInputTokens) ?? 0;
  const miss = nonNegativeNumber(data.inputCacheMissTokens);
  const hasCache = (cached ?? 0) > 0 || (written ?? 0) > 0;

  return {
    ...(written ? { cache_creation_input_tokens: written } : {}),
    ...(cached ? { cache_read_input_tokens: cached } : {}),
    input_tokens: hasCache
      ? (miss ?? Math.max(0, totalInput - (cached ?? 0) - (written ?? 0)))
      : totalInput,
    output_tokens: nonNegativeNumber(data.totalOutputTokens) ?? 0,
  };
};

export const encodeAnthropicStream = (source: ReadableStream<Uint8Array>, model: string) => {
  const messageId = `msg_${randomUUID().replaceAll('-', '')}`;
  let finalized = false;
  let nextIndex = 0;
  let stopReason: string | undefined;
  let textIndex: number | undefined;
  let thinkingIndex: number | undefined;
  let usage: AnthropicStreamUsage = { input_tokens: 0, output_tokens: 0 };
  const tools = new Map<number, { blockIndex: number; id: string; name: string }>();
  const closeTextBlocks = (controller: TransformStreamDefaultController<string>) => {
    for (const index of [textIndex, thinkingIndex]) {
      if (index !== undefined)
        controller.enqueue(sse('content_block_stop', { index, type: 'content_block_stop' }));
    }
    textIndex = undefined;
    thinkingIndex = undefined;
  };
  const finalize = (controller: TransformStreamDefaultController<string>) => {
    if (finalized) return;
    finalized = true;
    closeTextBlocks(controller);
    for (const { blockIndex } of tools.values()) {
      controller.enqueue(
        sse('content_block_stop', { index: blockIndex, type: 'content_block_stop' }),
      );
    }
    controller.enqueue(
      sse('message_delta', {
        delta: {
          stop_reason: tools.size
            ? 'tool_use'
            : stopReason === 'max_tokens'
              ? 'max_tokens'
              : 'end_turn',
          stop_sequence: null,
        },
        type: 'message_delta',
        usage,
      }),
    );
    controller.enqueue(sse('message_stop', { type: 'message_stop' }));
  };
  return parseProtocolStream(source)
    .pipeThrough(
      new TransformStream<ProtocolEvent, string>({
        start(controller) {
          controller.enqueue(
            sse('message_start', {
              message: {
                content: [],
                id: messageId,
                model,
                role: 'assistant',
                stop_reason: null,
                type: 'message',
                usage: { input_tokens: 0, output_tokens: 0 },
              },
              type: 'message_start',
            }),
          );
        },
        transform(event, controller) {
          if (finalized) return;
          const part =
            (event.type === 'content_part' || event.type === 'reasoning_part') &&
            isRecord(event.data) &&
            event.data.partType === 'text'
              ? event.data
              : undefined;
          const content =
            event.type === 'text' || event.type === 'reasoning'
              ? typeof event.data === 'string'
                ? event.data
                : undefined
              : typeof part?.content === 'string'
                ? part.content
                : undefined;
          if (content !== undefined) {
            const isThinking = event.type === 'reasoning' || event.type === 'reasoning_part';
            let index = isThinking ? thinkingIndex : textIndex;
            if (index === undefined) {
              closeTextBlocks(controller);
              index = nextIndex++;
              controller.enqueue(
                sse('content_block_start', {
                  content_block: isThinking
                    ? { signature: '', thinking: '', type: 'thinking' }
                    : { text: '', type: 'text' },
                  index,
                  type: 'content_block_start',
                }),
              );
              if (isThinking) thinkingIndex = index;
              else textIndex = index;
            }
            if (content) {
              controller.enqueue(
                sse('content_block_delta', {
                  delta: isThinking
                    ? { thinking: content, type: 'thinking_delta' }
                    : { text: content, type: 'text_delta' },
                  index,
                  type: 'content_block_delta',
                }),
              );
            }
          } else if (
            event.type === 'reasoning_signature' &&
            thinkingIndex !== undefined &&
            typeof event.data === 'string' &&
            event.data
          ) {
            controller.enqueue(
              sse('content_block_delta', {
                delta: { signature: event.data, type: 'signature_delta' },
                index: thinkingIndex,
                type: 'content_block_delta',
              }),
            );
          } else if (event.type === 'tool_calls' && Array.isArray(event.data)) {
            closeTextBlocks(controller);
            for (const chunk of event.data) {
              if (!isRecord(chunk) || typeof chunk.index !== 'number') continue;
              const fn = isRecord(chunk.function) ? chunk.function : {};
              let tool = tools.get(chunk.index);
              if (!tool) {
                tool = {
                  blockIndex: nextIndex++,
                  id: String(chunk.id || `tool_${randomUUID()}`),
                  name: String(fn.name || ''),
                };
                tools.set(chunk.index, tool);
                controller.enqueue(
                  sse('content_block_start', {
                    content_block: { id: tool.id, input: {}, name: tool.name, type: 'tool_use' },
                    index: tool.blockIndex,
                    type: 'content_block_start',
                  }),
                );
              }
              if (typeof fn.arguments === 'string' && fn.arguments)
                controller.enqueue(
                  sse('content_block_delta', {
                    delta: { partial_json: fn.arguments, type: 'input_json_delta' },
                    index: tool.blockIndex,
                    type: 'content_block_delta',
                  }),
                );
            }
          } else if (event.type === 'usage' && isRecord(event.data)) {
            usage = toAnthropicStreamUsage(event.data);
          } else if (event.type === 'stop') {
            const reason = typeof event.data === 'string' ? event.data : undefined;
            if (!stopReason && reason && reason !== 'message_stop') stopReason = reason;
          } else if (event.type === 'error') {
            finalized = true;
            controller.enqueue(
              sse('error', {
                error: {
                  message: isRecord(event.data)
                    ? String(event.data.message || 'Model request failed')
                    : String(event.data),
                  type: 'api_error',
                },
                type: 'error',
              }),
            );
          }
        },
        flush(controller) {
          finalize(controller);
        },
      }),
    )
    .pipeThrough(new TextEncoderStream());
};
