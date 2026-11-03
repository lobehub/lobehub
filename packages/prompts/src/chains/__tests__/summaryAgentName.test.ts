import { describe, expect, it } from 'vitest';

import { chainSummaryAgentName } from '../summaryAgentName';

describe('chainSummaryAgentName', () => {
  it('should create a payload with system and user messages including the provided content and current language', () => {
    // Arrange
    const content = '这是一段测试文本';
    const currentLanguage = 'en-US';

    // Act
    const result = chainSummaryAgentName(content, currentLanguage);

    // Assert
    expect(result).toEqual({
      messages: [
        {
          content: `你是一名擅长起名的起名大师，名字需要有文学内涵，注重精炼和赋子意境，你需要将用户的描述总结为 10 个字以内的角色，并翻译为目标语言。格式要求如下：\n输入: {文本作为JSON引用字符串} [locale]\n输出: {角色名}`,
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
        { content: `输入: {${content}} [${currentLanguage}]`, role: 'user' },
      ],
    });
  });
});
