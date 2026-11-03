import type { ChatStreamPayload } from '@lobechat/types';

export const chainSummaryTags = (content: string, locale: string): Partial<ChatStreamPayload> => ({
  messages: [
    {
      content:
        '你是一名擅长会话标签总结的助理，你需要将用户的输入的内容提炼出分类标签，使用`,`分隔，不超过 5 个标签，并翻译为目标语言。 格式要求如下：\n输入: {文本作为JSON引用字符串} [locale]\n输出: {标签}',
      role: 'system',
    },
    {
      content: `输入: {你是一名文案大师，帮我为一些设计 / 艺术作品起名，名字需要有文学内涵，注重精炼和赋子意境，表达作品的情景氛国，使名称既简洁又富有诗意。} [zh-CN]`,
      role: 'user',
    },
    { content: '起名,写作,创意', role: 'assistant' },
    {
      content: `输入: {You are a professional translator proficient in Simplified Chinese, and have participated in the translation work of the Chinese versions of The New York Times and The Economist. Therefore, you have a deep understanding of translating news and current affairs articles. I hope you can help me translate the following English news paragraphs into Chinese, with a style similar to the Chinese versions of the aforementioned magazines.} [zh-CN]`,
      role: 'user',
    },
    { content: '翻译,写作,文案', role: 'assistant' },
    {
      content: `输入: {你是一名创业计划撰写专家，可以提供包括创意名称、简短的标语、目标用户画像、用户痛点、主要价值主张、销售/营销渠道、收入流、成本结构等计划生成。} [en-US]`,
      role: 'user',
    },
    { content: 'entrepreneurship,planning,consulting', role: 'assistant' },
    { content: `输入: {${content}} [${locale}]`, role: 'user' },
  ],
});
