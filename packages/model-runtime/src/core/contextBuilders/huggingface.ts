import type { OpenAIChatMessage, UserMessageContentPart } from '../../types';

/**
 * Converts OpenAI-style chat messages to Hugging Face chat completion format.
 *
 * @param messages - Array of OpenAI chat messages
 * @returns Array of messages compatible with HuggingFace ChatCompletionInput
 */
export function convertOpenAIMessagesToHFFormat(messages: OpenAIChatMessage[]): Array<{
  content?:
    | string
    | Array<
        | { text: string; type: 'text' }
        | { image_url: { detail?: 'auto' | 'low' | 'high'; url: string }; type: 'image_url' }
      >;
  name?: string;
  role: string;
  tool_call_id?: string;
  tool_calls?: Array<{ function: { arguments?: string; name: string }; id: string; type: string }>;
}> {
  return messages.map((message) => {
    // Handle content conversion: string stays as string, content parts get converted
    let convertedContent:
      | string
      | Array<
          | { text: string; type: 'text' }
          | { image_url: { detail?: 'auto' | 'low' | 'high'; url: string }; type: 'image_url' }
        >
      | undefined;

    if (typeof message.content === 'string') {
      convertedContent = message.content;
    } else if (Array.isArray(message.content)) {
      convertedContent = message.content.map((part: UserMessageContentPart) => {
        if (part.type === 'text') {
          return {
            text: part.text,
            type: 'text' as const,
          };
        } else if (part.type === 'image_url') {
          return {
            image_url: {
              detail: part.image_url.detail,
              url: part.image_url.url,
            },
            type: 'image_url' as const,
          };
        }
        // Fallback for unknown content types
        return { text: '', type: 'text' as const };
      });
    }

    return {
      content: convertedContent,
      name: message.name,
      role: message.role,
      tool_call_id: message.tool_call_id,
      tool_calls: message.tool_calls?.map((tc) => ({
        function: {
          arguments: tc.function.arguments,
          name: tc.function.name,
        },
        id: tc.id,
        type: 'function',
      })),
    };
  });
}
