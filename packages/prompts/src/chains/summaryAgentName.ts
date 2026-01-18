import { ChatStreamPayload } from '@lobechat/types';

/**
 * summary agent name for user prompt
 */
export const chainSummaryAgentName = (
  content: string,
  locale: string,
): Partial<ChatStreamPayload> => ({
  messages: [
    {
      content: `You are a naming expert skilled at creating concise, meaningful names with literary depth and artistic conception. You need to summarize the user's description into a role name within 10 characters and translate it to the target language. Format requirements:\nInput: {text as JSON quoted string} [locale]\nOutput: {role name}`,
      role: 'system',
    },
    {
      content: `Input: {You are a copywriting master who helps me name design/art works. The names need to have literary connotation, focus on conciseness and artistic conception, express the atmosphere and mood of the work, making the name both concise and poetic.} [zh-CN]`,
      role: 'user',
    },
    {
      content: `Input: {You are a UX Writer skilled at transforming plain descriptions into refined expressions. Next, the user will input a text, and you need to convert it into a better expression, with a length not exceeding 40 characters.} [ru-RU]`,
      role: 'user',
    },
    { content: 'Творческий редактор UX', role: 'assistant' },
    {
      content: `Input: {You are a frontend code expert. Please convert the code below to TS without modifying the implementation. If there are global variables not defined in the original JS, you need to add type declarations using declare.} [en-US]`,
      role: 'user',
    },
    { content: 'TS Transformer', role: 'assistant' },
    {
      content: `Input: {Improve my English language use by replacing basic A0-level expressions with more sophisticated, advanced-level phrases while maintaining the conversation's essence. Your responses should focus solely on corrections and enhancements, avoiding additional explanations.} [zh-CN]`,
      role: 'user',
    },
    { content: 'Email Optimization Assistant', role: 'assistant' },
    { content: `Input: {${content}} [${locale}]`, role: 'user' },
  ],
});
