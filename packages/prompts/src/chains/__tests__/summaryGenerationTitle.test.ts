import { describe, expect, it } from 'vitest';

import { chainSummaryGenerationTitle } from '../summaryGenerationTitle';

describe('chainSummaryGenerationTitle', () => {
  it('should generate correct chat payload for image modal', () => {
    const prompts = ['A beautiful sunset', 'Mountain landscape'];
    const modal = 'image' as const;
    const locale = 'zh-CN';

    const result = chainSummaryGenerationTitle(prompts, modal, locale);

    expect(result.messages).toHaveLength(2);
    expect(result.messages![0].role).toBe('system');
    expect(result.messages![1].role).toBe('user');
    expect(result.messages![0].content).toContain('AI image prompt');
    expect(result.messages![0].content).toContain(locale);
  });

  it('should generate correct chat payload for video modal', () => {
    const prompts = ['Dancing in the rain'];
    const modal = 'video' as const;
    const locale = 'en-US';

    const result = chainSummaryGenerationTitle(prompts, modal, locale);

    expect(result.messages![0].content).toContain('AI video prompt');
    expect(result.messages![0].content).toContain(locale);
  });

  it('should format single prompt correctly', () => {
    const prompts = ['Single prompt'];
    const modal = 'image' as const;
    const locale = 'zh-CN';

    const result = chainSummaryGenerationTitle(prompts, modal, locale);

    expect(result.messages![1].content).toContain('1. Single prompt');
  });

  it('should format multiple prompts with numbering', () => {
    const prompts = ['First prompt', 'Second prompt', 'Third prompt'];
    const modal = 'image' as const;
    const locale = 'zh-CN';

    const result = chainSummaryGenerationTitle(prompts, modal, locale);

    const userMessage = result.messages![1].content;
    expect(userMessage).toContain('1. First prompt');
    expect(userMessage).toContain('2. Second prompt');
    expect(userMessage).toContain('3. Third prompt');
  });

  it('should include system instructions about title requirements', () => {
    const prompts = ['Test prompt'];
    const modal = 'image' as const;
    const locale = 'zh-CN';

    const result = chainSummaryGenerationTitle(prompts, modal, locale);

    const systemMessage = result.messages![0].content;
    expect(systemMessage).toContain('资深的 AI 艺术创作者');
    expect(systemMessage).toContain('10个字以内');
    expect(systemMessage).toContain('不需要包含标点符号');
  });

  it('should handle empty prompts array', () => {
    const prompts: string[] = [];
    const modal = 'image' as const;
    const locale = 'zh-CN';

    const result = chainSummaryGenerationTitle(prompts, modal, locale);

    expect(result.messages![1].content).toContain('提示词：\n');
  });

  it('should handle different locales', () => {
    const prompts = ['Test'];
    const modal = 'image' as const;
    const customLocale = 'ja-JP';

    const result = chainSummaryGenerationTitle(prompts, modal, customLocale);

    expect(result.messages![0].content).toContain(customLocale);
  });

  it('should differentiate between image and video modals in instructions', () => {
    const prompts = ['Test prompt'];
    const locale = 'zh-CN';

    const imageResult = chainSummaryGenerationTitle(prompts, 'image', locale);
    const videoResult = chainSummaryGenerationTitle(prompts, 'video', locale);

    expect(imageResult.messages![0].content).toContain('AI image prompt');
    expect(videoResult.messages![0].content).toContain('AI video prompt');
  });

  it('should format prompts with newlines between them', () => {
    const prompts = ['Prompt one', 'Prompt two'];
    const modal = 'image' as const;
    const locale = 'zh-CN';

    const result = chainSummaryGenerationTitle(prompts, modal, locale);

    expect(result.messages![1].content).toContain('1. Prompt one\n2. Prompt two');
  });
});
