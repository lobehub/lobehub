import type {
  ChatStreamPayload,
  OpenAIChatMessage,
  UserMessageContentPart,
} from '@lobechat/model-runtime';
import { isRecord } from '@lobechat/utils/object';
import type OpenAI from 'openai';

const textFromParts = (content: unknown, transformFirst = (text: string) => text): string => {
  if (typeof content === 'string') return transformFirst(content);
  if (!Array.isArray(content)) return '';
  let foundText = false;
  return content
    .map((part) => {
      if (
        !isRecord(part) ||
        typeof part.text !== 'string' ||
        !['text', 'input_text', 'output_text'].includes(String(part.type))
      ) {
        return '';
      }
      const text = foundText ? part.text : transformFirst(part.text);
      if (part.text) foundText = true;
      return text;
    })
    .join('');
};

const stripLeadingAnthropicBillingHeader = (text: string) =>
  text.replace(/^x-anthropic-billing-header:[^\r\n]*(?:\r?\n(?:\r?\n)?)?/, '');

const unwrapLeadingSystemReminder = (text: string) =>
  text.replace(/^<system-reminder>([\s\S]*?)<\/system-reminder>/, '$1');

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

const contentWithImages = (
  content: unknown,
  transform = (text: string) => text,
): OpenAIChatMessage['content'] => {
  const images = imageParts(content);
  const text = transform(textFromParts(content));
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

interface NormalizeAnthropicRequestOptions {
  unwrapSystemReminders?: boolean;
}

export const normalizeAnthropicRequest = (
  request: Record<string, unknown>,
  model: string,
  options?: NormalizeAnthropicRequestOptions,
) => {
  const messages: OpenAIChatMessage[] = [];
  const system = textFromParts(request.system, stripLeadingAnthropicBillingHeader);
  if (system) messages.push({ content: system, role: 'system' });
  const transformUserText = options?.unwrapSystemReminders
    ? unwrapLeadingSystemReminder
    : undefined;

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
        transformUserText,
      );
      if (remaining.length) messages.push({ content: remaining, role: 'user' });
      continue;
    }
    const normalizedContent =
      role === 'assistant'
        ? contentWithAnthropicThinking(content)
        : contentWithImages(content, transformUserText);
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
      if (item.type === 'additional_tools' && Array.isArray(item.tools)) {
        messages.push({
          content: '',
          role: 'system',
          responsesTools: item.tools as OpenAI.Responses.Tool[],
        });
      } else if (
        item.type === 'reasoning' &&
        typeof item.id === 'string' &&
        Array.isArray(item.summary)
      ) {
        pendingReasoningItems?.push(
          item as unknown as NonNullable<
            NonNullable<OpenAIChatMessage['reasoning']>['responseItems']
          >[number],
        );
      } else if (
        ['function_call', 'custom_tool_call'].includes(String(item.type)) &&
        typeof item.call_id === 'string'
      ) {
        const toolCall = {
          function: {
            arguments: String(
              (item.type === 'custom_tool_call' ? item.input : item.arguments) ?? '',
            ),
            name: String(item.name || ''),
          },
          id: item.call_id,
          ...(typeof item.namespace === 'string' ? { namespace: item.namespace } : {}),
          type: item.type === 'custom_tool_call' ? 'custom' : 'function',
        };
        const previousMessage = messages.at(-1);

        // Responses history records every parallel call before their outputs.
        // Chat Completions requires those calls in one assistant message, followed
        // by the contiguous batch of tool-result messages.
        if (
          !pendingReasoningItems?.length &&
          previousMessage?.role === 'assistant' &&
          previousMessage.tool_calls?.length
        ) {
          previousMessage.tool_calls.push(toolCall);
        } else {
          messages.push({
            content: '',
            role: 'assistant',
            ...takePendingReasoning(),
            tool_calls: [toolCall],
          });
        }
      } else if (
        ['function_call_output', 'custom_tool_call_output'].includes(String(item.type)) &&
        typeof item.call_id === 'string'
      ) {
        messages.push({
          content: contentWithImages(item.output),
          ...(Array.isArray(item.output)
            ? {
                responsesOutput:
                  item.output as OpenAI.Responses.ResponseCustomToolCallOutput['output'],
              }
            : {}),
          role: 'tool',
          tool_call_id: item.call_id,
        });
      } else if (
        (item.type === undefined || item.type === 'message') &&
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
    max_tokens:
      typeof request.max_output_tokens === 'number' ? request.max_output_tokens : undefined,
    messages,
    model,
    reasoning: isRecord(request.reasoning) ? request.reasoning : undefined,
    responsesTools:
      Array.isArray(request.tools) &&
      request.tools.some(
        (tool) => isRecord(tool) && ['custom', 'namespace'].includes(String(tool.type)),
      )
        ? (request.tools as OpenAI.Responses.Tool[])
        : undefined,
    stream: true,
    temperature: typeof request.temperature === 'number' ? request.temperature : undefined,
    tools,
    top_p: typeof request.top_p === 'number' ? request.top_p : undefined,
  } satisfies ChatStreamPayload;
};
