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
        content: `You are an autocomplete engine for a chat input box. The user is composing a message to send to an AI assistant. Predict and complete what the USER is typing. Output ONLY the missing text to insert at the cursor.

CRITICAL RULES:
- You are completing the USER's message, NOT the AI assistant's response
- The completed text should read as something a human would type to ask, request, or tell an AI
- NEVER generate text that sounds like an AI assistant responding (e.g., "help you", "assist you", "I can help")
- Keep it short and natural, under 15 words
- Match the user's language

GOOD examples (user perspective):
"How can I " → "optimize my React component's performance?"
"Hi" → ", I need help with a TypeScript issue"
"Can you " → "explain how useEffect cleanup works?"
"帮我" → "写一个数据库查询的优化方案"
"Let me " → "describe the bug I'm seeing"
"我想" → "了解一下如何部署到 Kubernetes"

BAD examples (assistant perspective — NEVER do this):
"How can I " → "help you today?" ← WRONG: this is what an AI assistant says
"Hi" → ", how can I help you?" ← WRONG: assistant greeting
"Let me " → "explain that for you" ← WRONG: assistant offering to explain${contextBlock}`,
        role: 'system',
      },
      {
        content: `Before cursor: "${beforeCursor}"\nAfter cursor: "${afterCursor}"`,
        role: 'user',
      },
    ],
  };
};
