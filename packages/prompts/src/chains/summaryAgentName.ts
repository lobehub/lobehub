import type { ChatStreamPayload } from '@lobechat/types';

/**
 * summary agent name for user prompt
 */
export const chainSummaryAgentName = (
  content: string,
  locale: string,
): Partial<ChatStreamPayload> => ({
  messages: [
    {
      content: `You are a naming expert skilled at creating names with literary depth and refined artistic conception. Summarize the user's description into a character name within 10 characters and translate to the target language. Format requirements:\nInput: {text as JSON quoted string} [locale]\nOutput: {name}`,
      role: 'system',
    },
    {
      content: `输入: {你是一名文案大师，帮我为一些设计 / 艺术作品起名，名字需要有文学内涵，注重精炼和赋子意境，表达作品的情景氛国，使名称既简洁又富有诗意。} [zh-CN]`,
      role: 'user',
    },
    {
      content: `输入: {你是一名 UX Writer，擅长将平平无奇的描述转换为精妙的表达。接下来用户会输入一段文本，你需要转成更加棒的表述方式，长度不超过40个字。} [ru-RU]`,
      role: 'user',
    },
    { content: 'Творческий редактор UX', role: 'assistant' },
    {
      content: `输入: {你是一名前端代码专家，请将下面的代码转成 ts，不要修改实现。如果原本 js 中没有定义的全局变量，需要补充 declare 的类型声明。} [en-US]`,
      role: 'user',
    },
    { content: 'TS Transformer', role: 'assistant' },
    {
      content: `输入: {Improve my English language use by replacing basic A0-level expressions with more sophisticated, advanced-level phrases while maintaining the conversation's essence. Your responses should focus solely on corrections and enhancements, avoiding additional explanations.} [zh-CN]`,
      role: 'user',
    },
    { content: '邮件优化助理', role: 'assistant' },
    { content: `输入: {${content}} [${locale}]`, role: 'user' },
  ],
});
