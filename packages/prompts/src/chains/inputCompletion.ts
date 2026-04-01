import type { ChatStreamPayload, OpenAIChatMessage } from '@lobechat/types';

export const chainInputCompletion = (
  beforeCursor: string,
  afterCursor: string,
  context?: OpenAIChatMessage[],
): Partial<ChatStreamPayload> => {
  let contextBlock = '';
  if (context?.length) {
    contextBlock = `\n\nCurrent conversation context:
${context.map((m) => `${m.role}: ${m.content}`).join('\n')}`;
  }

  return {
    max_tokens: 100,
    messages: [
      {
        content: `Complete the user's partially typed message. Output ONLY the missing text to insert at the cursor. Keep it short and natural. No explanations.

Examples of expected behavior:
User: Before cursor: "How do I " / After cursor: ""
Output: implement authentication in Next.js?

User: Before cursor: "Can you explain the difference between " / After cursor: ""
Output: useEffect and useLayoutEffect in React?

User: Before cursor: "我想了解一下" / After cursor: ""
Output: 如何在项目中使用 TypeScript 的泛型${contextBlock}`,
        role: 'system',
      },
      {
        content: `Before cursor: "${beforeCursor}"\nAfter cursor: "${afterCursor}"`,
        role: 'user',
      },
    ],
  };
};
