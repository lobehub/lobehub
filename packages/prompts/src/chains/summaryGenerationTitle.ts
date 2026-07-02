import type { ChatStreamPayload } from '@lobechat/types';

export const chainSummaryGenerationTitle = (
  prompts: string[],
  modal: 'image' | 'video',
  locale: string,
): Partial<ChatStreamPayload> => {
  // Format multiple prompts for better readability
  const formattedPrompts = prompts.map((prompt, index) => `${index + 1}. ${prompt}`).join('\n');

  return {
    messages: [
      {
        content: `You are a senior AI art creator and language master. Based on the AI ${modal} prompt provided by the user, generate a title that concisely describes the core content of the creation. The title will be used to identify and manage the series of works. Keep it within 10 characters, without punctuation. Output language: ${locale}.`,
        role: 'system',
      },
      {
        content: `Prompts:\n${formattedPrompts}`,
        role: 'user',
      },
    ],
  };
};
