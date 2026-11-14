// cspell:ignore tokenx
import type { MessageContextAccounting, UIChatMessage } from '@lobechat/types';
import { estimateTokenCount } from 'tokenx';

import { countContextTokens } from './index';

/**
 * One message of a final chat request payload (OpenAI chat shape), as produced
 * by the context engine and sent to the model runtime. Typed structurally so
 * both `@lobechat/types` and `@lobechat/model-runtime` message types fit.
 */
export interface RequestPayloadMessage {
  content?: unknown;
  reasoning?: { content?: string; signature?: string } | string;
  reasoning_content?: string;
  role: string;
  tool_call_id?: string;
  tool_calls?: ReadonlyArray<{
    function?: { arguments?: string; name?: string };
    id?: string;
    thoughtSignature?: string;
    type?: string;
  }>;
}

export interface CountRequestPayloadTokensParams {
  /** Processed messages exactly as they are sent, system messages included. */
  messages: readonly RequestPayloadMessage[];
  /** The request's top-level `tools` array; omit when the request has none. */
  tools?: readonly unknown[];
}

/** The `<files_info>` block MessageContentProcessor appends to user content. */
const FILES_INFO_OPEN = '<files_info>';
const FILES_INFO_CLOSE = '</files_info>';

const estimate = (text: string | undefined) => (text ? estimateTokenCount(text) : 0);

/**
 * Text the provider tokenizes. Image, video and audio parts are skipped, as in
 * `countContextTokens`: providers bill them by media size, not by their
 * (often base64) URL text.
 */
const toText = (content: unknown): string => {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return JSON.stringify(content);

  return content
    .map((part) =>
      part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string'
        ? part.text
        : '',
    )
    .filter(Boolean)
    .join('\n');
};

/**
 * Split `<files_info>…</files_info>` blocks out of user text. A linear scan,
 * not a lazy regex: user text is uncontrolled, and many unclosed opening tags
 * would make the regex rescan to the end once per tag.
 */
const splitFileContext = (text: string) => {
  let fileContext = '';
  let rest = '';
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf(FILES_INFO_OPEN, cursor);
    if (start === -1) break;

    const end = text.indexOf(FILES_INFO_CLOSE, start + FILES_INFO_OPEN.length);
    // No closing tag after this opening means none after any later one either.
    if (end === -1) break;

    const blockEnd = end + FILES_INFO_CLOSE.length;
    rest += text.slice(cursor, start);
    fileContext += text.slice(start, blockEnd);
    cursor = blockEnd;
  }

  return { fileContext, rest: rest + text.slice(cursor) };
};

const toReasoning = (message: RequestPayloadMessage) => {
  if (message.reasoning) return message.reasoning;
  return message.reasoning_content ? { content: message.reasoning_content } : undefined;
};

/**
 * Map a payload message onto the `UIChatMessage` fields `countContextTokens`
 * reads, so the request is counted with the same rules as the compression
 * trigger: `tool_calls` become `tools` (id + name + arguments + type +
 * thoughtSignature), tool results stay `content` with their `tool_call_id`.
 */
const toAccountingMessage = (
  message: RequestPayloadMessage,
  content: string,
  index: number,
): UIChatMessage =>
  ({
    content,
    id: `request_payload_${index}`,
    reasoning: toReasoning(message),
    role: message.role,
    tool_call_id: message.tool_call_id,
    tools: message.tool_calls?.map((toolCall) => ({
      apiName: toolCall.function?.name,
      arguments: toolCall.function?.arguments,
      id: toolCall.id,
      thoughtSignature: toolCall.thoughtSignature,
      type: toolCall.type,
    })),
  }) as unknown as UIChatMessage;

/**
 * Estimate every token of one final chat request — the processed messages and
 * the `tools` array — by source, reusing {@link countContextTokens}.
 *
 * Unlike the compression trigger, which counts the stored conversation, this
 * counts what the context engine actually assembled: the system messages with
 * everything injected into them, history after truncation, and attachment
 * text inlined as `<files_info>` blocks (reported as `fileContext`). A
 * thinking signature replayed with a reasoning block counts with the per-call
 * `thoughtSignature`s, the other opaque signature a request echoes back.
 *
 * Counts are raw `tokenx` estimates (no drift multiplier).
 */
export const countRequestPayloadTokens = ({
  messages,
  tools = [],
}: CountRequestPayloadTokensParams): MessageContextAccounting => {
  const systemMessages: UIChatMessage[] = [];
  const conversationMessages: UIChatMessage[] = [];
  let fileContext = 0;
  let reasoningSignature = 0;

  messages.forEach((message, index) => {
    let content = toText(message.content);

    if (message.role === 'user') {
      const split = splitFileContext(content);
      content = split.rest;
      fileContext += estimate(split.fileContext);
    }

    const reasoning = toReasoning(message);
    if (reasoning && typeof reasoning === 'object') {
      reasoningSignature += estimate(reasoning.signature);
    }

    const target = message.role === 'system' ? systemMessages : conversationMessages;
    target.push(toAccountingMessage(message, content, index));
  });

  const options = { driftMultiplier: 1 };
  const system = countContextTokens({ messages: systemMessages, options }).rawTotal;
  const conversation = countContextTokens({
    messages: conversationMessages,
    options,
    tools: [...tools],
  });

  const bySource = {
    ...conversation.bySource,
    fileContext: conversation.bySource.fileContext + fileContext,
    thoughtSignature: conversation.bySource.thoughtSignature + reasoningSignature,
  };

  let total = system;
  for (const value of Object.values(bySource)) total += value;

  return {
    bySource,
    estimator: 'tokenx',
    messageCount: messages.length,
    system,
    total,
  };
};

/**
 * {@link countRequestPayloadTokens} for callers on the request path, where the
 * result is display-only: a counting failure is logged and yields `undefined`
 * instead of failing the model call.
 */
export const tryCountRequestPayloadTokens = (
  params: CountRequestPayloadTokensParams,
): MessageContextAccounting | undefined => {
  try {
    return countRequestPayloadTokens(params);
  } catch (error) {
    console.error('[context-engine] Failed to account request tokens:', error);
    return undefined;
  }
};
