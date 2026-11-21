import { randomUUID } from 'node:crypto';

import { isRecord } from '@lobechat/utils/object';

import type { BaseStreamEvent, ResponseUsage } from '../types/responses.type';
import {
  nonNegativeNumber,
  parseProtocolStream,
  type ProtocolEvent,
  sse,
} from './heterogeneous-direct.stream';

export const encodeResponsesStream = (source: ReadableStream<Uint8Array>, model: string) => {
  const responseId = `resp_${randomUUID().replaceAll('-', '')}`;
  let finalized = false;
  let nextOutputIndex = 0;
  const outputItems: unknown[] = [];
  let reasoningItemId: string | undefined;
  let reasoningOutputIndex: number | undefined;
  let reasoningText = '';
  let sequenceNumber = 0;
  let stopReason: unknown;
  let textOutputIndex: number | undefined;
  let outputText = '';
  let usage: ResponseUsage | undefined;
  const toolItems = new Map<
    number,
    {
      arguments: string;
      callId: string;
      id: string;
      name: string;
      namespace?: string;
      outputIndex: number;
      type: 'custom' | 'function';
    }
  >();
  const response = {
    created_at: Math.floor(Date.now() / 1000),
    error: null,
    id: responseId,
    incomplete_details: null,
    instructions: null,
    model,
    object: 'response',
    output: [],
    status: 'in_progress',
  };
  const responseSse = (
    event: BaseStreamEvent['type'],
    data: Omit<BaseStreamEvent, 'sequence_number'> & Record<string, unknown>,
  ) => {
    const sequencedData = {
      ...data,
      sequence_number: sequenceNumber++,
    } satisfies BaseStreamEvent;
    return sse(event, sequencedData);
  };
  const completeReasoning = (
    controller: TransformStreamDefaultController<string>,
    responseItem?: unknown,
  ) => {
    if (reasoningOutputIndex === undefined) {
      if (responseItem === undefined) return;
      const outputIndex = nextOutputIndex++;
      const item = isRecord(responseItem) ? { ...responseItem, status: 'completed' } : responseItem;
      outputItems[outputIndex] = item;
      controller.enqueue(
        responseSse('response.output_item.added', {
          item: isRecord(responseItem) ? { ...responseItem, status: 'in_progress' } : responseItem,
          output_index: outputIndex,
          type: 'response.output_item.added',
        }),
      );
      controller.enqueue(
        responseSse('response.output_item.done', {
          item,
          output_index: outputIndex,
          type: 'response.output_item.done',
        }),
      );
      return;
    }

    const outputIndex = reasoningOutputIndex;
    const itemId =
      isRecord(responseItem) && typeof responseItem.id === 'string'
        ? responseItem.id
        : reasoningItemId || `rs_${responseId}`;
    const item = isRecord(responseItem)
      ? { ...responseItem, status: 'completed' }
      : {
          id: itemId,
          status: 'completed',
          summary: [{ text: reasoningText, type: 'summary_text' }],
          type: 'reasoning',
        };
    outputItems[outputIndex] = item;
    controller.enqueue(
      responseSse('response.reasoning_summary_text.done', {
        item_id: itemId,
        output_index: outputIndex,
        summary_index: 0,
        text: reasoningText,
        type: 'response.reasoning_summary_text.done',
      }),
    );
    controller.enqueue(
      responseSse('response.output_item.done', {
        item,
        output_index: outputIndex,
        type: 'response.output_item.done',
      }),
    );
    reasoningItemId = undefined;
    reasoningOutputIndex = undefined;
    reasoningText = '';
  };
  const finalize = (controller: TransformStreamDefaultController<string>) => {
    if (finalized) return;
    finalized = true;
    completeReasoning(controller);
    if (textOutputIndex !== undefined) {
      const item = {
        content: [{ annotations: [], text: outputText, type: 'output_text' }],
        id: `msg_${responseId}`,
        role: 'assistant',
        status: 'completed',
        type: 'message',
      };
      outputItems[textOutputIndex] = item;
      controller.enqueue(
        responseSse('response.output_text.done', {
          content_index: 0,
          item_id: `msg_${responseId}`,
          output_index: textOutputIndex,
          text: outputText,
          type: 'response.output_text.done',
        }),
      );
      controller.enqueue(
        responseSse('response.content_part.done', {
          content_index: 0,
          item_id: `msg_${responseId}`,
          output_index: textOutputIndex,
          part: { annotations: [], text: outputText, type: 'output_text' },
          type: 'response.content_part.done',
        }),
      );
      controller.enqueue(
        responseSse('response.output_item.done', {
          item,
          output_index: textOutputIndex,
          type: 'response.output_item.done',
        }),
      );
    }
    for (const tool of toolItems.values()) {
      const item = {
        ...(tool.type === 'custom' ? { input: tool.arguments } : { arguments: tool.arguments }),
        ...(tool.namespace ? { namespace: tool.namespace } : {}),
        call_id: tool.callId,
        id: tool.id,
        name: tool.name,
        status: 'completed',
        type: tool.type === 'custom' ? 'custom_tool_call' : 'function_call',
      };
      outputItems[tool.outputIndex] = item;
      const doneType =
        tool.type === 'custom'
          ? 'response.custom_tool_call_input.done'
          : 'response.function_call_arguments.done';
      controller.enqueue(
        responseSse(doneType, {
          ...(tool.type === 'custom' ? { input: tool.arguments } : { arguments: tool.arguments }),
          item_id: tool.id,
          output_index: tool.outputIndex,
          type: doneType,
        }),
      );
      controller.enqueue(
        responseSse('response.output_item.done', {
          item,
          output_index: tool.outputIndex,
          type: 'response.output_item.done',
        }),
      );
    }
    const incomplete = stopReason === 'max_tokens';
    const type = incomplete ? 'response.incomplete' : 'response.completed';
    controller.enqueue(
      responseSse(type, {
        response: {
          ...response,
          incomplete_details: incomplete ? { reason: 'max_output_tokens' } : null,
          output: outputItems.filter(Boolean),
          status: incomplete ? 'incomplete' : 'completed',
          usage,
        },
        type,
      }),
    );
    controller.enqueue('data: [DONE]\n\n');
  };
  return parseProtocolStream(source)
    .pipeThrough(
      new TransformStream<ProtocolEvent, string>({
        start(controller) {
          controller.enqueue(
            responseSse('response.created', { response, type: 'response.created' }),
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
          const isReasoning = event.type === 'reasoning' || event.type === 'reasoning_part';
          if (content && !isReasoning) {
            outputText += content;
            if (textOutputIndex === undefined) {
              textOutputIndex = nextOutputIndex++;
              controller.enqueue(
                responseSse('response.output_item.added', {
                  item: {
                    content: [],
                    id: `msg_${responseId}`,
                    role: 'assistant',
                    status: 'in_progress',
                    type: 'message',
                  },
                  output_index: textOutputIndex,
                  type: 'response.output_item.added',
                }),
              );
              controller.enqueue(
                responseSse('response.content_part.added', {
                  content_index: 0,
                  item_id: `msg_${responseId}`,
                  output_index: textOutputIndex,
                  part: { annotations: [], text: '', type: 'output_text' },
                  type: 'response.content_part.added',
                }),
              );
            }
            controller.enqueue(
              responseSse('response.output_text.delta', {
                content_index: 0,
                delta: content,
                item_id: `msg_${responseId}`,
                output_index: textOutputIndex,
                type: 'response.output_text.delta',
              }),
            );
          } else if (content && isReasoning) {
            reasoningText += content;
            if (reasoningOutputIndex === undefined) {
              reasoningItemId = event.id || `rs_${responseId}`;
              reasoningOutputIndex = nextOutputIndex++;
              controller.enqueue(
                responseSse('response.output_item.added', {
                  item: {
                    id: reasoningItemId,
                    status: 'in_progress',
                    summary: [],
                    type: 'reasoning',
                  },
                  output_index: reasoningOutputIndex,
                  type: 'response.output_item.added',
                }),
              );
            }
            controller.enqueue(
              responseSse('response.reasoning_summary_text.delta', {
                delta: content,
                item_id: reasoningItemId,
                output_index: reasoningOutputIndex,
                summary_index: 0,
                type: 'response.reasoning_summary_text.delta',
              }),
            );
          } else if (event.type === 'reasoning_response_item') {
            completeReasoning(controller, event.data);
          } else if (event.type === 'tool_calls' && Array.isArray(event.data)) {
            for (const chunk of event.data) {
              if (!isRecord(chunk) || typeof chunk.index !== 'number') continue;
              const fn = isRecord(chunk.function) ? chunk.function : {};
              let tool = toolItems.get(chunk.index);
              if (!tool) {
                tool = {
                  arguments: '',
                  callId: String(chunk.id || `call_${randomUUID()}`),
                  id: `fc_${randomUUID()}`,
                  name: String(fn.name || ''),
                  namespace: typeof chunk.namespace === 'string' ? chunk.namespace : undefined,
                  outputIndex: nextOutputIndex++,
                  type: chunk.type === 'custom' ? 'custom' : 'function',
                };
                toolItems.set(chunk.index, tool);
                controller.enqueue(
                  responseSse('response.output_item.added', {
                    item: {
                      ...(tool.type === 'custom' ? { input: '' } : { arguments: '' }),
                      ...(tool.namespace ? { namespace: tool.namespace } : {}),
                      call_id: tool.callId,
                      id: tool.id,
                      name: tool.name,
                      status: 'in_progress',
                      type: tool.type === 'custom' ? 'custom_tool_call' : 'function_call',
                    },
                    output_index: tool.outputIndex,
                    type: 'response.output_item.added',
                  }),
                );
              }
              if (typeof fn.arguments === 'string') {
                tool.arguments += fn.arguments;
                const deltaType =
                  tool.type === 'custom'
                    ? 'response.custom_tool_call_input.delta'
                    : 'response.function_call_arguments.delta';
                controller.enqueue(
                  responseSse(deltaType, {
                    delta: fn.arguments,
                    item_id: tool.id,
                    output_index: tool.outputIndex,
                    type: deltaType,
                  }),
                );
              }
            }
          } else if (event.type === 'usage' && isRecord(event.data)) {
            const inputTokens = nonNegativeNumber(event.data.totalInputTokens) ?? 0;
            const outputTokens = nonNegativeNumber(event.data.totalOutputTokens) ?? 0;
            usage = {
              input_tokens: inputTokens,
              input_tokens_details: {
                cached_tokens: nonNegativeNumber(event.data.inputCachedTokens) ?? 0,
              },
              output_tokens: outputTokens,
              output_tokens_details: {
                reasoning_tokens: nonNegativeNumber(event.data.outputReasoningTokens) ?? 0,
              },
              total_tokens: inputTokens + outputTokens,
            };
          } else if (event.type === 'stop') {
            if (stopReason === undefined && event.data) stopReason = event.data;
          } else if (event.type === 'error') {
            const message = isRecord(event.data)
              ? String(event.data.message || 'Model request failed')
              : String(event.data);
            finalized = true;
            controller.enqueue(
              responseSse('response.failed', {
                response: {
                  ...response,
                  error: { code: 'server_error', message },
                  output: outputItems.filter(Boolean),
                  status: 'failed',
                },
                type: 'response.failed',
              }),
            );
            controller.enqueue('data: [DONE]\n\n');
          }
        },
        flush(controller) {
          finalize(controller);
        },
      }),
    )
    .pipeThrough(new TextEncoderStream());
};
