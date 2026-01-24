import { ChatStreamPayload, UIChatMessage } from '@lobechat/types';

import { chatHistoryPrompts } from '../prompts';

/**
 * Chain for compressing conversation context into a summary
 * Used when conversation history exceeds token threshold
 */
export const chainCompressContext = (messages: UIChatMessage[]): Partial<ChatStreamPayload> => ({
  messages: [
    {
      content: `You are a conversation summarizer. Your task is to create a concise summary of the conversation that preserves the key information, decisions made, and important context. The summary should be in the same language as the conversation.

Guidelines:
- Keep the summary concise but comprehensive
- Preserve key facts, decisions, and conclusions
- Maintain chronological order of important events
- Use bullet points for clarity when appropriate
- Do not add any information not present in the original conversation
- The summary will be used as context for continuing the conversation`,
      role: 'system',
    },
    {
      content: `${chatHistoryPrompts(messages)}

Please summarize the above conversation. The summary should:
1. Capture all essential information and context
2. Be concise enough to reduce token usage
3. Enable seamless continuation of the conversation

Output ONLY the summary, no additional commentary.`,
      role: 'user',
    },
  ],
});
