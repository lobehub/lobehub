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

export const buildAnthropicMessage = async (
  message: OpenAIChatMessage,
): Promise<Anthropic.Messages.MessageParam | undefined> => {
  const content = message.content as string | UserMessageContentPart[];

  switch (message.role) {
    case 'system': {
      return { content: content as string, role: 'user' };
    }

    case 'user': {
      return {
        content: typeof content === 'string' ? content : await buildArrayContent(content),
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
            ...(message.tool_calls.map((tool) => ({
              id: tool.id,
              input: JSON.parse(tool.function.arguments),
              name: tool.function.name,
              type: 'tool_use',
            })) as any),
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
  let pendingToolResults: Anthropic.ToolResultBlockParam[] = [];

  // First collect all tool_call_id from assistant messages for subsequent lookup
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

  for (const message of oaiMessages) {
    const index = oaiMessages.indexOf(message);

    // refs: https://docs.anthropic.com/claude/docs/tool-use#tool-use-and-tool-result-content-blocks
    if (message.role === 'tool') {
      // Handle different content types in tool messages
      const toolResultContent = Array.isArray(message.content)
        ? await buildArrayContent(message.content)
        : !message.content
          ? [{ text: '<empty_content>', type: 'text' as const }]
          : [{ text: message.content, type: 'text' as const }];

      // Check if this tool message has a corresponding assistant tool call
      if (message.tool_call_id && validToolCallIds.has(message.tool_call_id)) {
        pendingToolResults.push({
          content: toolResultContent as Anthropic.ToolResultBlockParam['content'],
          tool_use_id: message.tool_call_id,
          type: 'tool_result',
        });

        // If this is the last message or the next message is not 'tool', add accumulated tool results as a 'user' message
        if (index === oaiMessages.length - 1 || oaiMessages[index + 1].role !== 'tool') {
          messages.push({
            content: pendingToolResults,
            role: 'user',
          });
          pendingToolResults = [];
        }
      } else {
        // If tool message has no corresponding assistant tool call, treat as plain text
        const fallbackContent = Array.isArray(message.content)
          ? JSON.stringify(message.content)
          : message.content || '<empty_content>';
        messages.push({
          content: fallbackContent,
          role: 'user',
        });
      }
    } else {
      const anthropicMessage = await buildAnthropicMessage(message);
      // Filter out undefined messages (e.g., empty assistant messages)
      if (anthropicMessage) {
        messages.push(anthropicMessage);
      }
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
