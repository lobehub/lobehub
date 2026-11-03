import type { ChatStreamPayload } from '@lobechat/types';

export const chainTranslate = (
  content: string,
  targetLang: string,
): Partial<ChatStreamPayload> => ({
  messages: [
    {
      content: `You are a professional translator. Translate the input text to ${targetLang}.

Rules:
- Output ONLY the translated text, no explanations or additional context
- Preserve technical terms, code identifiers, API keys, and proper nouns exactly as they appear
- Maintain the original formatting and structure
- Use natural, idiomatic expressions in the target language`,
      role: 'system',
    },
    {
      content,
      role: 'user',
    },
  ],
});
