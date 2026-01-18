import { ChatStreamPayload } from '@lobechat/types';

export const chainSummaryDescription = (
  content: string,
  locale: string,
): Partial<ChatStreamPayload> => ({
  messages: [
    {
      content: `You are an assistant skilled at summarizing skills. You need to summarize the user's input into a role skill profile within 20 characters. The content should ensure clear information, logical clarity, and effectively convey the role's skills and experience, and translate it to the target language: ${locale}. Format requirements:\nInput: {text as JSON quoted string} [locale]\nOutput: {profile}`,
      role: 'system',
    },
    {
      content: `Input: {You are a copywriting master who helps me name design/art works. The names need to have literary connotation, focus on conciseness and artistic conception, express the atmosphere and mood of the work, making the name both concise and poetic.} [zh-CN]`,
      role: 'user',
    },
    { content: 'Good at naming creative art works', role: 'assistant' },
    {
      content: `Input: {You are a business plan writing expert who can provide plan generation including creative names, short slogans, target user personas, user pain points, main value propositions, sales/marketing channels, revenue streams, cost structures, etc.} [en-US]`,
      role: 'user',
    },
    { content: 'Good at business plan writing and consulting', role: 'assistant' },
    {
      content: `Input: {You are a frontend expert. Please convert the code below to TS without modifying the implementation. If there are global variables not defined in the original JS, you need to add type declarations using declare.} [zh-CN]`,
      role: 'user',
    },
    { content: 'Good at TS conversion and type declaration', role: 'assistant' },
    {
      content: `Input: {
Write user documentation for developers on API usage in a normal manner. You need to provide easy-to-use and readable documentation content from the user's perspective.\n\nAn example of a standard API documentation is as follows:\n\n\`\`\`markdown
---
title: useWatchPluginMessage
description: Listen for plugin messages from LobeChat
nav: API
---\n\n\`useWatchPluginMessage\` is a React Hook encapsulated by the Chat Plugin SDK for listening to plugin messages sent from LobeChat.
} [ru-RU]`,
      role: 'user',
    },
    {
      content:
        'Специализируется на создании хорошо структурированной и профессиональной документации README для GitHub с точными техническими терминами',
      role: 'assistant',
    },
    {
      content: `Input: {You are a business plan writing expert who can provide plan generation including creative names, short slogans, target user personas, user pain points, main value propositions, sales/marketing channels, revenue streams, cost structures, etc.} [zh-CN]`,
      role: 'user',
    },
    { content: 'Good at business plan writing and consulting', role: 'assistant' },
    { content: `输入: {${content}} [${locale}]`, role: 'user' },
  ],
  temperature: 0,
});
