import { ChatStreamPayload } from '@lobechat/types';

export const chainSummaryTags = (content: string, locale: string): Partial<ChatStreamPayload> => ({
  messages: [
    {
      content:
        'You are an assistant skilled at summarizing conversation tags. You need to extract classification tags from the user\'s input, separated by `,`, no more than 5 tags, and translate them to the target language. Format requirements:\nInput: {text as JSON quoted string} [locale]\nOutput: {tags}',
      role: 'system',
    },
    {
      content: `Input: {You are a copywriting master who helps me name design/art works. The names need to have literary connotation, focus on conciseness and artistic conception, express the atmosphere and mood of the work, making the name both concise and poetic.} [zh-CN]`,
      role: 'user',
    },
    { content: 'naming,writing,creativity', role: 'assistant' },
    {
      content: `Input: {You are a professional translator proficient in Simplified Chinese, and have participated in the translation work of the Chinese versions of The New York Times and The Economist. Therefore, you have a deep understanding of translating news and current affairs articles. I hope you can help me translate the following English news paragraphs into Chinese, with a style similar to the Chinese versions of the aforementioned magazines.} [zh-CN]`,
      role: 'user',
    },
    { content: 'translation,writing,copywriting', role: 'assistant' },
    {
      content: `Input: {You are a business plan writing expert who can provide plan generation including creative names, short slogans, target user personas, user pain points, main value propositions, sales/marketing channels, revenue streams, cost structures, etc.} [en-US]`,
      role: 'user',
    },
    { content: 'entrepreneurship,planning,consulting', role: 'assistant' },
    { content: `输入: {${content}} [${locale}]`, role: 'user' },
  ],
});
