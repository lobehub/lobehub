import { describe, expect, it } from 'vitest';

import { chainRewriteGenerationPrompt } from '../rewriteGenerationPrompt';

describe('chainRewriteGenerationPrompt', () => {
  it('should build image rewrite payload with system and user messages', () => {
    const prompt = '一只在雨夜街头奔跑的狐狸';

    const result = chainRewriteGenerationPrompt({ mode: 'image', prompt });

    expect(result.messages).toHaveLength(2);
    expect(result.messages![0].role).toBe('system');
    expect(result.messages![1].role).toBe('user');
    expect(result.messages![0].content).toContain('expert image prompt engineer');
    expect(result.messages![1].content).toBe(prompt);
  });

  it('should build video rewrite payload with video-specific system prompt', () => {
    const prompt = 'A cat jumps over a fence';

    const result = chainRewriteGenerationPrompt({ mode: 'video', prompt });

    expect(result.messages![0].content).toContain('expert video prompt engineer');
    expect(result.messages![0].content).toContain('Temporal progression');
    expect(result.messages![1].content).toBe(prompt);
  });

  it('should build text rewrite payload with text-specific system prompt', () => {
    const prompt = '帮我优化这个 JavaScript 函数';

    const result = chainRewriteGenerationPrompt({ mode: 'text', prompt });

    expect(result.messages![0].content).toContain('expert prompt optimizer');
    expect(result.messages![0].content).toContain('Do NOT add new requirements');
    expect(result.messages![1].content).toBe(prompt);
  });
});
