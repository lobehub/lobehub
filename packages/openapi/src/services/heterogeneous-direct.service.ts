import { randomUUID } from 'node:crypto';

import type {
  ChatStreamPayload,
  OpenAIChatMessage,
  UserMessageContentPart,
} from '@lobechat/model-runtime';
import { RequestTrigger } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import type { ServerDefaultHeterogeneousAgentType } from '@/server/modules/ModelRuntime';
import {
  initModelRuntimeFromServerConfig,
  resolveServerDefaultHeterogeneousModel,
} from '@/server/modules/ModelRuntime';

import type { BaseStreamEvent } from '../types/responses.type';

export const SERVER_DEFAULT_MODEL_ALIAS = 'lobehub-default';

const textFromParts = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) =>
      isRecord(part) &&
      typeof part.text === 'string' &&
      ['text', 'input_text', 'output_text'].includes(String(part.type))
        ? part.text
        : '',
    )
    .join('');
};

const imageParts = (content: unknown) => {
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (!isRecord(part) || !['image', 'input_image'].includes(String(part.type))) return [];
    if (typeof part.image_url === 'string') {
      return [{ image_url: { url: part.image_url }, type: 'image_url' as const }];
    }
    const source = part.source;
    if (!isRecord(source)) return [];
    const url =
      source.type === 'base64' && typeof source.data === 'string'
        ? `data:${String(source.media_type || 'image/png')};base64,${source.data}`
        : typeof source.url === 'string'
          ? source.url
          : undefined;
    return url ? [{ image_url: { url }, type: 'image_url' as const }] : [];
  });
};

const contentWithImages = (content: unknown): OpenAIChatMessage['content'] => {
  const images = imageParts(content);
  const text = textFromParts(content);
  return images.length > 0 ? [...(text ? [{ text, type: 'text' as const }] : []), ...images] : text;
};

const anthropicThinkingParts = (content: unknown): UserMessageContentPart[] => {
  if (!Array.isArray(content)) return [];
  return content.flatMap<UserMessageContentPart>((part) => {
    if (!isRecord(part)) return [];
    if (
      part.type === 'thinking' &&
      typeof part.thinking === 'string' &&
      typeof part.signature === 'string'
    ) {
      return [{ signature: part.signature, thinking: part.thinking, type: 'thinking' as const }];
    }
    if (part.type === 'redacted_thinking' && typeof part.data === 'string') {
      return [{ data: part.data, type: 'redacted_thinking' as const }];
    }
    return [];
  });
};

const contentWithAnthropicThinking = (content: unknown): OpenAIChatMessage['content'] => {
  const thinking = anthropicThinkingParts(content);
  if (thinking.length === 0) return contentWithImages(content);
  const visible = contentWithImages(content);
  return [
    ...thinking,
    ...(typeof visible === 'string'
      ? visible
        ? [{ text: visible, type: 'text' as const }]
        : []
      : visible),
  ];
};

export const normalizeAnthropicRequest = (request: Record<string, unknown>, model: string) => {
  const messages: OpenAIChatMessage[] = [];
  const system = textFromParts(request.system);
  if (system) messages.push({ content: system, role: 'system' });

  for (const rawMessage of Array.isArray(request.messages) ? request.messages : []) {
    if (!isRecord(rawMessage) || !['assistant', 'user'].includes(String(rawMessage.role))) continue;
    const content = rawMessage.content;
    const role = rawMessage.role as 'assistant' | 'user';
    const toolCalls = Array.isArray(content)
      ? content.flatMap((part) =>
          isRecord(part) &&
          part.type === 'tool_use' &&
          typeof part.id === 'string' &&
          typeof part.name === 'string'
            ? [
                {
                  function: { arguments: JSON.stringify(part.input ?? {}), name: part.name },
                  id: part.id,
                  type: 'function' as const,
                },
              ]
            : [],
        )
      : [];
    const toolResults = Array.isArray(content)
      ? content.filter((part) => isRecord(part) && part.type === 'tool_result')
      : [];
    if (toolResults.length > 0) {
      for (const result of toolResults) {
        messages.push({
          content: contentWithImages(result.content),
          role: 'tool',
          tool_call_id: String(result.tool_use_id),
        });
      }
      const remaining = contentWithImages(
        (content as unknown[]).filter((part) => !isRecord(part) || part.type !== 'tool_result'),
      );
      if (remaining.length) messages.push({ content: remaining, role: 'user' });
      continue;
    }
    const normalizedContent =
      role === 'assistant' ? contentWithAnthropicThinking(content) : contentWithImages(content);
    const hasAnthropicThinking =
      Array.isArray(normalizedContent) &&
      normalizedContent.some(
        (part) => part.type === 'thinking' || part.type === 'redacted_thinking',
      );
    messages.push({
      content: normalizedContent,
      ...(hasAnthropicThinking ? { provider: 'anthropic' } : {}),
      role,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    });
  }

  const tools = Array.isArray(request.tools)
    ? request.tools.flatMap((tool) =>
        isRecord(tool) && typeof tool.name === 'string'
          ? [
              {
                function: {
                  description: typeof tool.description === 'string' ? tool.description : undefined,
                  name: tool.name,
                  parameters: isRecord(tool.input_schema) ? tool.input_schema : {},
                },
                type: 'function' as const,
              },
            ]
          : [],
      )
    : undefined;
  const thinking = isRecord(request.thinking) ? request.thinking : undefined;
  return {
    max_tokens: typeof request.max_tokens === 'number' ? request.max_tokens : undefined,
    messages,
    model,
    stream: true,
    temperature: typeof request.temperature === 'number' ? request.temperature : undefined,
    thinking: thinking as ChatStreamPayload['thinking'],
    tools,
    top_p: typeof request.top_p === 'number' ? request.top_p : undefined,
  } satisfies ChatStreamPayload;
};

export const normalizeResponsesRequest = (request: Record<string, unknown>, model: string) => {
  const messages: OpenAIChatMessage[] = [];
  let pendingReasoningItems: NonNullable<OpenAIChatMessage['reasoning']>['responseItems'] = [];
  const takePendingReasoning = () => {
    if (!pendingReasoningItems?.length) return {};
    const reasoning = { reasoning: { responseItems: pendingReasoningItems } };
    pendingReasoningItems = [];
    return reasoning;
  };
  if (typeof request.instructions === 'string') {
    messages.push({ content: request.instructions, role: 'system' });
  }
  if (typeof request.input === 'string') {
    messages.push({ content: request.input, role: 'user' });
  } else if (Array.isArray(request.input)) {
    for (const item of request.input) {
      if (!isRecord(item)) continue;
      if (item.type === 'reasoning' && typeof item.id === 'string' && Array.isArray(item.summary)) {
        pendingReasoningItems?.push(
          item as unknown as NonNullable<
            NonNullable<OpenAIChatMessage['reasoning']>['responseItems']
          >[number],
        );
      } else if (item.type === 'function_call' && typeof item.call_id === 'string') {
        messages.push({
          content: '',
          role: 'assistant',
          ...takePendingReasoning(),
          tool_calls: [
            {
              function: { arguments: String(item.arguments || ''), name: String(item.name || '') },
              id: item.call_id,
              type: 'function',
            },
          ],
        });
      } else if (item.type === 'function_call_output' && typeof item.call_id === 'string') {
        messages.push({
          content: String(item.output || ''),
          role: 'tool',
          tool_call_id: item.call_id,
        });
      } else if (
        item.type === 'message' &&
        ['assistant', 'developer', 'system', 'user'].includes(String(item.role))
      ) {
        messages.push({
          content: contentWithImages(item.content),
          role: item.role === 'developer' ? 'system' : (item.role as OpenAIChatMessage['role']),
          ...(item.role === 'assistant' ? takePendingReasoning() : {}),
        });
      }
    }
  }
  if (pendingReasoningItems?.length) {
    messages.push({ content: '', role: 'assistant', ...takePendingReasoning() });
  }
  const tools = Array.isArray(request.tools)
    ? request.tools.flatMap((tool) =>
        isRecord(tool) && tool.type === 'function' && typeof tool.name === 'string'
          ? [
              {
                function: {
                  description: typeof tool.description === 'string' ? tool.description : undefined,
                  name: tool.name,
                  parameters: isRecord(tool.parameters) ? tool.parameters : {},
                },
                type: 'function' as const,
              },
            ]
          : [],
      )
    : undefined;
  return {
    apiMode: 'responses',
    max_tokens:
      typeof request.max_output_tokens === 'number' ? request.max_output_tokens : undefined,
    messages,
    model,
    reasoning: isRecord(request.reasoning) ? request.reasoning : undefined,
    stream: true,
    temperature: typeof request.temperature === 'number' ? request.temperature : undefined,
    tools,
    top_p: typeof request.top_p === 'number' ? request.top_p : undefined,
  } satisfies ChatStreamPayload;
};

interface ProtocolEvent {
  data: unknown;
  id?: string;
  type: string;
}

const parseProtocolStream = (stream: ReadableStream<Uint8Array>) => {
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

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export const encodeAnthropicStream = (source: ReadableStream<Uint8Array>) => {
  const messageId = `msg_${randomUUID().replaceAll('-', '')}`;
  let finalized = false;
  let nextIndex = 0;
  let stopReason: string | undefined;
  let textIndex: number | undefined;
  let thinkingIndex: number | undefined;
  let usage = { input_tokens: 0, output_tokens: 0 };
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
        usage: { output_tokens: usage.output_tokens },
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
                model: SERVER_DEFAULT_MODEL_ALIAS,
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
          if (event.type === 'text' || event.type === 'reasoning') {
            const isThinking = event.type === 'reasoning';
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
            controller.enqueue(
              sse('content_block_delta', {
                delta: isThinking
                  ? { thinking: String(event.data), type: 'thinking_delta' }
                  : { text: String(event.data), type: 'text_delta' },
                index,
                type: 'content_block_delta',
              }),
            );
          } else if (event.type === 'reasoning_signature' && thinkingIndex !== undefined) {
            controller.enqueue(
              sse('content_block_delta', {
                delta: { signature: String(event.data), type: 'signature_delta' },
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
            usage = {
              input_tokens: Number(event.data.totalInputTokens || 0),
              output_tokens: Number(event.data.totalOutputTokens || 0),
            };
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

export const encodeResponsesStream = (source: ReadableStream<Uint8Array>) => {
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
  let usage: { input_tokens: number; output_tokens: number; total_tokens: number } | undefined;
  const toolItems = new Map<
    number,
    { arguments: string; callId: string; id: string; name: string; outputIndex: number }
  >();
  const response = {
    created_at: Math.floor(Date.now() / 1000),
    error: null,
    id: responseId,
    incomplete_details: null,
    instructions: null,
    model: SERVER_DEFAULT_MODEL_ALIAS,
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
        arguments: tool.arguments,
        call_id: tool.callId,
        id: tool.id,
        name: tool.name,
        status: 'completed',
        type: 'function_call',
      };
      outputItems[tool.outputIndex] = item;
      controller.enqueue(
        responseSse('response.function_call_arguments.done', {
          arguments: tool.arguments,
          item_id: tool.id,
          output_index: tool.outputIndex,
          type: 'response.function_call_arguments.done',
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
          if (event.type === 'text') {
            outputText += String(event.data);
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
                delta: String(event.data),
                item_id: `msg_${responseId}`,
                output_index: textOutputIndex,
                type: 'response.output_text.delta',
              }),
            );
          } else if (event.type === 'reasoning') {
            reasoningText += String(event.data);
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
                delta: String(event.data),
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
                  outputIndex: nextOutputIndex++,
                };
                toolItems.set(chunk.index, tool);
                controller.enqueue(
                  responseSse('response.output_item.added', {
                    item: {
                      arguments: '',
                      call_id: tool.callId,
                      id: tool.id,
                      name: tool.name,
                      status: 'in_progress',
                      type: 'function_call',
                    },
                    output_index: tool.outputIndex,
                    type: 'response.output_item.added',
                  }),
                );
              }
              if (typeof fn.arguments === 'string') {
                tool.arguments += fn.arguments;
                controller.enqueue(
                  responseSse('response.function_call_arguments.delta', {
                    delta: fn.arguments,
                    item_id: tool.id,
                    output_index: tool.outputIndex,
                    type: 'response.function_call_arguments.delta',
                  }),
                );
              }
            }
          } else if (event.type === 'usage' && isRecord(event.data)) {
            const inputTokens = Number(event.data.totalInputTokens || 0);
            const outputTokens = Number(event.data.totalOutputTokens || 0);
            usage = {
              input_tokens: inputTokens,
              output_tokens: outputTokens,
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

export const invokeServerDefaultModel = async (params: {
  agentType: ServerDefaultHeterogeneousAgentType;
  model: string;
  payload: ChatStreamPayload;
  signal: AbortSignal;
  userId: string;
  workspaceId?: string;
}) => {
  const resolvedModel = await resolveServerDefaultHeterogeneousModel(
    params.agentType,
    params.model,
  );
  const { deploymentName } = resolvedModel;
  const model = deploymentName ?? resolvedModel.model;
  const runtime = await initModelRuntimeFromServerConfig({
    actorUserId: params.userId,
    workspaceId: params.workspaceId,
  });
  const response = await runtime.chat(
    {
      ...params.payload,
      model,
      stream: true,
    },
    { metadata: { trigger: RequestTrigger.Api }, signal: params.signal, user: params.userId },
  );
  if (!response.body) throw new Error('Model runtime returned an empty stream');
  return { model, response };
};
