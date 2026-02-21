import type { ChatStreamPayload } from '@lobechat/types';

export const DEFAULT_REWRITE_QUERY =
  'Given the following conversation and a follow-up question, rephrase the follow up question to be a standalone question, in its original language. Keep as much details as possible from previous messages. Keep entity names and all.';

export const chainRewriteQuery = (
  query: string,
  context: string[],
  instruction: string = DEFAULT_REWRITE_QUERY,
): Partial<ChatStreamPayload> => ({
  messages: [
    {
      content: `${instruction}
<chatHistory>
${context.join('\n')}
</chatHistory>
`,
      role: 'system',
    },
    {
      content: `Follow Up Input: ${query}, it's standalone query:`,
      role: 'user',
    },
  ],
});
