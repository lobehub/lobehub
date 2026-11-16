import type Anthropic from '@anthropic-ai/sdk';

/**
 * Replay a non-streaming Messages reply as the stream events the decoder reads.
 */
export const transformMessageToStream = (message: Anthropic.Message) =>
  new ReadableStream<Anthropic.MessageStreamEvent>({
    start(controller) {
      controller.enqueue({
        message,
        type: 'message_start',
      } satisfies Anthropic.MessageStreamEvent);

      message.content?.forEach((block, index) => {
        if (block.type === 'tool_use' || block.type === 'server_tool_use') {
          controller.enqueue({
            content_block: block,
            index,
            type: 'content_block_start',
          } satisfies Anthropic.MessageStreamEvent);

          controller.enqueue({
            delta: {
              partial_json: JSON.stringify(block.input ?? {}),
              type: 'input_json_delta',
            },
            index,
            type: 'content_block_delta',
          } satisfies Anthropic.MessageStreamEvent);
        }

        if (block.type === 'thinking' || block.type === 'redacted_thinking') {
          controller.enqueue({
            content_block: block,
            index,
            type: 'content_block_start',
          } satisfies Anthropic.MessageStreamEvent);
        }

        if (block.type === 'text') {
          controller.enqueue({
            delta: { text: block.text, type: 'text_delta' },
            index,
            type: 'content_block_delta',
          } satisfies Anthropic.MessageStreamEvent);
        }
      });

      controller.enqueue({
        delta: {
          stop_reason: message.stop_reason,
          stop_sequence: message.stop_sequence ?? null,
        },
        type: 'message_delta',
        usage: {
          cache_creation_input_tokens: message.usage?.cache_creation_input_tokens ?? null,
          cache_read_input_tokens: message.usage?.cache_read_input_tokens ?? null,
          input_tokens: message.usage?.input_tokens ?? null,
          // `message_delta.usage` is cumulative, so it repeats the full output count.
          output_tokens: message.usage?.output_tokens ?? 0,
          server_tool_use: message.usage?.server_tool_use ?? null,
        },
      } satisfies Anthropic.MessageStreamEvent);

      controller.enqueue({ type: 'message_stop' } satisfies Anthropic.MessageStreamEvent);
      controller.close();
    },
  });
