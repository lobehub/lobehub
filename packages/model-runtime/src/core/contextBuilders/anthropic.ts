import Anthropic from '@anthropic-ai/sdk';
import { imageUrlToBase64 } from '@lobechat/utils';
import OpenAI from 'openai';

import { OpenAIChatMessage, UserMessageContentPart } from '../../types';
import { parseDataUri } from '../../utils/uriParser';

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

      if (type === 'base64')
        return {
          source: {
            data: base64 as string,
            media_type: mimeType as Anthropic.Base64ImageSource['media_type'],
            type: 'base64',
          },
          type: 'image',
        };

      if (type === 'url') {
        const { base64, mimeType } = await imageUrlToBase64(content.image_url.url);
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
): Promise<Anthropic.Messages.MessageParam> => {
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
        const rawContent =
          typeof content === 'string'
            ? ([{ text: message.content, type: 'text' }] as UserMessageContentPart[])
            : content;

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
      return { content: content as string, role: 'assistant' };
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

  // 首先收集所有 assistant 消息中的 tool_call_id 以便后续查找
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
      // 检查这个工具消息是否有对应的 assistant 工具调用
      if (message.tool_call_id && validToolCallIds.has(message.tool_call_id)) {
        pendingToolResults.push({
          content: [{ text: message.content as string, type: 'text' }],
          tool_use_id: message.tool_call_id,
          type: 'tool_result',
        });

        // 如果这是最后一个消息或者下一个消息不是 'tool'，则添加累积的工具结果作为一个 'user' 消息
        if (index === oaiMessages.length - 1 || oaiMessages[index + 1].role !== 'tool') {
          messages.push({
            content: pendingToolResults,
            role: 'user',
          });
          pendingToolResults = [];
        }
      } else {
        // 如果工具消息没有对应的 assistant 工具调用，则作为普通文本处理
        messages.push({
          content: message.content as string,
          role: 'user',
        });
      }
    } else {
      const anthropicMessage = await buildAnthropicMessage(message);
      messages.push({ ...anthropicMessage, role: anthropicMessage.role });
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
