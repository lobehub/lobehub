import type { ChatStreamPayload } from '@lobechat/types';

export const chainLangDetect = (content: string): Partial<ChatStreamPayload> => ({
  messages: [
    {
      content:
        '你是一名精通全世界语言的语言专家，你需要识别用户输入的内容，以国际标准 locale 进行输出',
      role: 'system',
    },
    {
      content: '{你好}',
      role: 'user',
    },
    {
      content: 'zh-CN',
      role: 'assistant',
    },
    {
      content: '{hello}',
      role: 'user',
    },
    {
      content: 'en-US',
      role: 'assistant',
    },
    {
      content: `{${content}}`,
      role: 'user',
    },
  ],
});
