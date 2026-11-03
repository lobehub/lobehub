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
        content: `你是一位资深的 AI 艺术创作者和语言大师。你需要根据用户提供的 AI ${modal} prompt 总结出一个标题。这个标题应简洁地描述创作的核心内容，将用于标识和管理该系列作品。字数需控制在10个字以内，不需要包含标点符号，输出语言为：${locale}。`,
        role: 'system',
      },
      {
        content: `提示词：\n${formattedPrompts}`,
        role: 'user',
      },
    ],
  };
};
