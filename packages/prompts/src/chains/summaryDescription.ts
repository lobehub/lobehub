import type { ChatStreamPayload } from '@lobechat/types';

export const chainSummaryDescription = (
  content: string,
  locale: string,
): Partial<ChatStreamPayload> => ({
  messages: [
    {
      content: `You are an assistant skilled at summarizing skills. Summarize the user's input into a concise role skill description within 20 characters. Ensure the content is clear, logically organized, and effectively conveys the role's skills and experience. Translate to the target language: ${locale}. Format requirements:\nInput: {text as JSON quoted string} [locale]\nOutput: {description}`,
      role: 'system',
    },
    {
      content: `输入: {你是一名文案大师，帮我为一些设计 / 艺术作品起名，名字需要有文学内涵，注重精炼和赋子意境，表达作品的情景氛国，使名称既简洁又富有诗意。} [zh-CN]`,
      role: 'user',
    },
    { content: '擅长文创艺术作品起名', role: 'assistant' },
    {
      content: `输入: {你是一名创业计划撰写专家，可以提供包括创意名称、简短的标语、目标用户画像、用户痛点、主要价值主张、销售/营销渠道、收入流、成本结构等计划生成。} [en-US]`,
      role: 'user',
    },
    { content: 'Good at business plan writing and consulting', role: 'assistant' },
    {
      content: `输入: {You are a frontend expert. Please convert the code below to TS without modifying the implementation. If there are global variables not defined in the original JS, you need to add type declarations using declare.} [zh-CN]`,
      role: 'user',
    },
    { content: '擅长 ts 转换和补充类型声明', role: 'assistant' },
    {
      content: `输入: {
用户正常书写面向开发者的 API 用户使用文档。你需要从用户的视角来提供比较易用易读的文档内容。\n\n一个标准的 API 文档示例如下：\n\n\`\`\`markdown
---
title: useWatchPluginMessage
description: 监听获取 LobeChat 发过来的插件消息
nav: API
---\n\n\`useWatchPluginMessage\` 是 Chat Plugin SDK 封装一个的 React Hook，用于监听从 LobeChat 发过来的插件消息。
} [ru-RU]`,
      role: 'user',
    },
    {
      content:
        'Специализируется на создании хорошо структурированной и профессиональной документации README для GitHub с точными техническими терминами',
      role: 'assistant',
    },
    {
      content: `输入: {你是一名创业计划撰写专家，可以提供包括创意名称、简短的标语、目标用户画像、用户痛点、主要价值主张、销售/营销渠道、收入流、成本结构等计划生成。} [zh-CN]`,
      role: 'user',
    },
    { content: '擅长创业计划撰写与咨询', role: 'assistant' },
    { content: `输入: {${content}} [${locale}]`, role: 'user' },
  ],
  temperature: 0,
});
