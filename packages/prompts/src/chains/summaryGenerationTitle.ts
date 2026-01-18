import { ChatStreamPayload } from '@lobechat/types';

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
        content: `You are a senior AI art creator and language master. You need to summarize a title based on the AI ${modal} prompt provided by the user. This title should concisely describe the core content of the creation and will be used to identify and manage this series of works. The word count should be limited to within 10 characters, no punctuation is needed, and the output language is: ${locale}.`,
        role: 'system',
      },
      {
        content: `Prompt:\n${formattedPrompts}`,
        role: 'user',
      },
    ],
  };
};
