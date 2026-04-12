import type Anthropic from '@anthropic-ai/sdk';
import { imageUrlToBase64 } from '@lobechat/utils';
import type OpenAI from 'openai';

import type { OpenAIChatMessage, UserMessageContentPart } from '../../types';
import { parseDataUri } from '../../utils/uriParser';

const ANTHROPIC_SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const isImageTypeSupported = (mimeType: string | null): boolean => {
  if (!mimeType) return true;
  return ANTHROPIC_SUPPORTED_IMAGE_TYPES.has(mimeType.toLowerCase());
};

/**
 * Check if a text value contains visible (non-whitespace) characters.
 * Used to filter out empty/whitespace-only messages that would cause Anthropic API errors.
 */
const hasVisibleText = (text: string | null | undefined): text is string => !!text?.trim();

export const buildAnthropicBlock = async (
  content: UserMessageContentPart,
): Promise<Anthropic.ContentBlock | Anthropic.ImageBlockParam | undefined> => {
  switch (content.type) {
    case 'thinking': {
      // just pass-through the content
      return content as any;
    }

    case 'text': {
      if (!!content.text) return content as any;

      return undefined;
    }

    case 'image_url': {
      const { mimeType, base64, type } = parseDataUri(content.image_url.url);

      if (type === 'base64') {
        if (!isImageTypeSupported(mimeType)) return undefined;

        return {
          source: {
            data: base64 as string,
            media_type: mimeType as Anthropic.Base64ImageSource['media_type'],
            type: 'base64',
          },
          type: 'image',
        };
      }

      if (type === 'url') {
        const { base64, mimeType } = await imageUrlToBase64(content.image_url.url);

        if (!isImageTypeSupported(mimeType)) return undefined;

        return {
          source: {
            data: base64 as string,
            media_type: mimeType as Anthropic.Base64ImageSource['media_type'],
            type: 'base64',
          },
          type: 'image',
        };
      }

      throw new Error(`Invalid image URL: ${content.image_url.url}`);
    }
  }
};

const buildArrayContent = async (content: UserMessageContentPart[]) => {
  let messageContent = (await Promise.all(
    (content as UserMessageContentPart[]).map(async (c) => await buildAnthropicBlock(c)),
  )) as Anthropic.Messages.ContentBlockParam[];

  messageContent = messageContent.filter(Boolean);

  return messageContent;
};

/**
 * Build a single Anthropic tool_result block from an OpenAI tool message.
 * Returns undefined if tool_call_id is missing. Uses '<empty_content>' placeholder
 * when content is empty, as Anthropic requires non-empty tool_result content.
 */
const buildAnthropicToolResultBlock = async (
  message: Pick<OpenAIChatMessage, 'content' | 'tool_call_id'>,
): Promise<Anthropic.ToolResultBlockParam | undefined> => {
  if (!message.tool_call_id) return undefined;

  const toolResultContent = Array.isArray(message.content)
    ? await buildArrayContent(message.content)
    : hasVisibleText(message.content)
      ? [{ text: message.content, type: 'text' as const }]
      : [];

  return {
    content: (toolResultContent.length > 0
      ? toolResultContent
      : [
          { text: '<empty_content>', type: 'text' as const },
        ]) as Anthropic.ToolResultBlockParam['content'],
    tool_use_id: message.tool_call_id,
    type: 'tool_result',
  };
};

export const buildAnthropicMessage = async (
  message: OpenAIChatMessage,
): Promise<Anthropic.Messages.MessageParam | undefined> => {
  const content = message.content as string | UserMessageContentPart[];

  switch (message.role) {
    case 'system': {
      return { content: content as string, role: 'user' };
    }

    case 'user': {
      // Filter out empty user messages to prevent Anthropic API validation errors.
      // Empty messages can appear after context truncation or user edits.
      if (Array.isArray(content)) {
        const messageContent = await buildArrayContent(content);
        if (messageContent.length === 0) return undefined;

        return {
          content: messageContent,
          role: 'user',
        };
      }

      if (!hasVisibleText(content)) return undefined;

      return {
        content,
        role: 'user',
      };
    }

    case 'tool': {
      // refs: https://docs.anthropic.com/claude/docs/tool-use#tool-use-and-tool-result-content-blocks
      return {
        content: [
          {
            content: message.content,
            tool_use_id: message.tool_call_id,
            type: 'tool_result',
          } as any,
        ],
        role: 'user',
      };
    }

    case 'assistant': {
      // if there is tool_calls , we need to covert the tool_calls to tool_use content block
      // refs: https://docs.anthropic.com/claude/docs/tool-use#tool-use-and-tool-result-content-blocks
      if (message.tool_calls && message.tool_calls.length > 0) {
        // Handle content: string with text, array, null/undefined/empty -> filter out
        const rawContent =
          typeof content === 'string' && content.trim()
            ? ([{ text: content, type: 'text' }] as UserMessageContentPart[])
            : Array.isArray(content)
              ? content
              : []; // null/undefined/empty string -> empty array (will be filtered)

        const messageContent = await buildArrayContent(rawContent);

        return {
          content: [
            // avoid empty text content block
            ...messageContent,
            ...(message.tool_calls.map((tool) => {
              let input: Record<string, unknown> = {};
              try {
                input = JSON.parse(tool.function.arguments);
              } catch {}
              return {
                id: tool.id,
                input,
                name: tool.function.name,
                type: 'tool_use',
              };
            }) as any),
          ].filter(Boolean),
          role: 'assistant',
        };
      }

      // or it's a plain assistant message
      // Handle array content (e.g., content with thinking blocks)
      if (Array.isArray(content)) {
        const messageContent = await buildArrayContent(content);
        if (messageContent.length === 0) return undefined;
        return { content: messageContent, role: 'assistant' };
      }

      // Anthropic API requires non-empty content, filter out empty/whitespace-only content
      const textContent = content?.trim();
      if (!textContent) return undefined;
      return { content: textContent, role: 'assistant' };
    }

    case 'function': {
      return { content: content as string, role: 'assistant' };
    }
  }
};

export const buildAnthropicMessages = async (
  oaiMessages: OpenAIChatMessage[],
  options: { enabledContextCaching?: boolean } = {},
): Promise<Anthropic.Messages.MessageParam[]> => {
  const messages: Anthropic.Messages.MessageParam[] = [];

  // === Two-pass strategy to guarantee tool_use / tool_result pairing ===
  //
  // Anthropic requires every tool_use block in an assistant message to have a
  // matching tool_result block in the immediately following user message. The old
  // sequential approach relied on message ordering, which broke when messages were
  // truncated, reordered, or deleted — causing "tool_use ids were found without
  // tool_result blocks" errors.
  //
  // Pass 1: Collect all valid tool_call_ids from assistant messages, then build a
  //         Map<tool_call_id, ToolResultBlock> from matching tool messages.
  // Pass 2: For each assistant message, only keep tool_calls that have a paired
  //         tool_result, and emit the paired tool_results right after.
  //         Unpaired tool messages degrade to plain-text user messages.

  // Pass 1a: Collect valid tool_call_ids from assistant messages
  const validToolCallIds = new Set<string>();
  for (const message of oaiMessages) {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      message.tool_calls.forEach((call) => {
        if (call.id) {
          validToolCallIds.add(call.id);
        }
      });
    }
  }

  // Pass 1b: Pre-build tool_result blocks indexed by tool_call_id
  const toolResultsByCallId = new Map<string, Anthropic.ToolResultBlockParam>();
  for (const message of oaiMessages) {
    if (
      message.role !== 'tool' ||
      !message.tool_call_id ||
      !validToolCallIds.has(message.tool_call_id)
    )
      continue;

    const toolResultBlock = await buildAnthropicToolResultBlock(message);
    if (toolResultBlock) {
      toolResultsByCallId.set(message.tool_call_id, toolResultBlock);
    }
  }

  // Pass 2: Build final message array with guaranteed tool_use/tool_result pairing
  for (const message of oaiMessages) {
    if (message.role === 'assistant') {
      // Only keep tool_calls that have a matching tool_result in the Map
      const pairedToolCalls = message.tool_calls?.filter(
        (toolCall) => !!toolCall.id && toolResultsByCallId.has(toolCall.id),
      );

      const anthropicMessage = await buildAnthropicMessage({
        ...message,
        tool_calls: pairedToolCalls?.length ? pairedToolCalls : undefined,
      });

      if (anthropicMessage) {
        messages.push(anthropicMessage);
      }

      // Emit paired tool_results as a user message immediately after the assistant message
      if (pairedToolCalls?.length) {
        messages.push({
          content: pairedToolCalls.flatMap((toolCall) => {
            const toolResultBlock = toolResultsByCallId.get(toolCall.id);
            return toolResultBlock ? [toolResultBlock] : [];
          }),
          role: 'user',
        });
      }

      continue;
    }

    if (message.role === 'tool') {
      // Already handled in Pass 1b and emitted above — skip
      if (message.tool_call_id && validToolCallIds.has(message.tool_call_id)) {
        continue;
      }

      // Orphan tool message (no matching assistant tool_call) — degrade to plain text
      const fallbackContent = Array.isArray(message.content)
        ? JSON.stringify(message.content)
        : message.content || '<empty_content>';
      messages.push({
        content: fallbackContent,
        role: 'user',
      });

      continue;
    }

    const anthropicMessage = await buildAnthropicMessage(message);
    if (anthropicMessage) {
      messages.push(anthropicMessage);
    }
  }

  const lastMessage = messages.at(-1);
  if (options.enabledContextCaching && !!lastMessage) {
    if (typeof lastMessage.content === 'string') {
      lastMessage.content = [
        {
          cache_control: { type: 'ephemeral' },
          text: lastMessage.content as string,
          type: 'text',
        },
      ];
    } else {
      const lastContent = lastMessage.content.at(-1);

      if (
        lastContent &&
        lastContent.type !== 'thinking' &&
        lastContent.type !== 'redacted_thinking'
      ) {
        lastContent.cache_control = { type: 'ephemeral' };
      }
    }
  }
  return messages;
};

export const buildAnthropicTools = (
  tools?: OpenAI.ChatCompletionTool[],
  options: { enabledContextCaching?: boolean } = {},
) => {
  if (!tools) return;

  return tools.map(
    (tool, index): Anthropic.Tool => ({
      cache_control:
        options.enabledContextCaching && index === tools.length - 1
          ? { type: 'ephemeral' }
          : undefined,
      description: tool.function.description,
      input_schema: tool.function.parameters as Anthropic.Tool.InputSchema,
      name: tool.function.name,
    }),
  );
};

export const buildSearchTool = (): Anthropic.WebSearchTool20250305 => {
  const maxUses = process.env.ANTHROPIC_MAX_USES;

  return {
    name: 'web_search',
    type: 'web_search_20250305',
    ...(maxUses &&
      Number.isInteger(Number(maxUses)) &&
      Number(maxUses) > 0 && {
        max_uses: Number(maxUses),
      }),
  };
};
