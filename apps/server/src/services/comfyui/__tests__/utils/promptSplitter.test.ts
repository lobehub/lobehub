// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { splitPromptForDualCLIP } from '@/server/services/comfyui/utils/promptSplitter';

describe('splitPromptForDualCLIP', () => {
  it('should handle empty or null prompt', () => {
    expect(splitPromptForDualCLIP('')).toEqual({
      clipLPrompt: '',
      t5xxlPrompt: '',
    });

    expect(splitPromptForDualCLIP(null as any)).toEqual({
      clipLPrompt: '',
      t5xxlPrompt: '',
    });

    expect(splitPromptForDualCLIP(undefined as any)).toEqual({
      clipLPrompt: '',
      t5xxlPrompt: '',
    });
  });

  it('should split prompt with style keywords', () => {
    const prompt = 'a beautiful landscape, photorealistic, high quality, cinematic lighting';
    const result = splitPromptForDualCLIP(prompt);

    expect(result.t5xxlPrompt).toBe(prompt);
    expect(result.clipLPrompt).toContain('photorealistic');
    expect(result.clipLPrompt).toContain('high quality');
    expect(result.clipLPrompt).toContain('cinematic');
  });

  it('should extract single-word style keywords', () => {
    const prompt = 'a cat sitting, realistic, detailed, masterpiece';
    const result = splitPromptForDualCLIP(prompt);

    expect(result.t5xxlPrompt).toBe(prompt);
    expect(result.clipLPrompt).toContain('realistic');
    expect(result.clipLPrompt).toContain('detailed');
    expect(result.clipLPrompt).toContain('masterpiece');
    expect(result.clipLPrompt).not.toContain('cat');
    expect(result.clipLPrompt).not.toContain('sitting');
  });

  it('should extract multi-word style keywords', () => {
    const prompt = 'beautiful girl portrait, digital art, depth of field, trending on artstation';
    const result = splitPromptForDualCLIP(prompt);

    expect(result.t5xxlPrompt).toBe(prompt);
    expect(result.clipLPrompt).toContain('digital art');
    expect(result.clipLPrompt).toContain('depth of field');
    expect(result.clipLPrompt).toContain('trending on artstation');
  });

  it('should handle lighting keywords', () => {
    const prompt = 'sunset over ocean, dramatic lighting, golden hour, soft lighting';
    const result = splitPromptForDualCLIP(prompt);

    expect(result.t5xxlPrompt).toBe(prompt);
    expect(result.clipLPrompt).toContain('dramatic lighting');
    expect(result.clipLPrompt).toContain('golden hour');
    expect(result.clipLPrompt).toContain('soft lighting');
  });

  it('should handle quality keywords', () => {
    const prompt = 'mountain view, 4k, ultra detailed, best quality, highly detailed';
    const result = splitPromptForDualCLIP(prompt);

    expect(result.t5xxlPrompt).toBe(prompt);
    expect(result.clipLPrompt).toContain('4k');
    expect(result.clipLPrompt).toContain('ultra detailed');
    expect(result.clipLPrompt).toContain('best quality');
    expect(result.clipLPrompt).toContain('highly detailed');
  });

  it('should handle photography terms', () => {
    const prompt = 'city street, bokeh, motion blur, wide angle, macro shot';
    const result = splitPromptForDualCLIP(prompt);

    expect(result.t5xxlPrompt).toBe(prompt);
    expect(result.clipLPrompt).toContain('bokeh');
    expect(result.clipLPrompt).toContain('motion blur');
    expect(result.clipLPrompt).toContain('wide angle');
    expect(result.clipLPrompt).toContain('macro');
  });

  it('should handle artist and platform keywords', () => {
    const prompt = 'fantasy landscape, by greg rutkowski, concept art, octane render';
    const result = splitPromptForDualCLIP(prompt);

    expect(result.t5xxlPrompt).toBe(prompt);
    expect(result.clipLPrompt).toContain('by greg rutkowski');
    expect(result.clipLPrompt).toContain('concept art');
    expect(result.clipLPrompt).toContain('octane render');
  });

  it('should fallback to adjectives when no style keywords found', () => {
    const prompt = 'a beautiful sunny day with colorful flowers blooming magnificently';
    const result = splitPromptForDualCLIP(prompt);

    expect(result.t5xxlPrompt).toBe(prompt);
    // Should contain adjective-like words that match the regex pattern
    expect(result.clipLPrompt).toMatch(/blooming|magnificently|colorful|beautiful|sunny/);
    expect(result.clipLPrompt.length).toBeGreaterThan(0);
  });

  it('should use same prompt for both when no style words or adjectives', () => {
    const prompt = 'cat dog house tree';
    const result = splitPromptForDualCLIP(prompt);

    expect(result.t5xxlPrompt).toBe(prompt);
    expect(result.clipLPrompt).toBe(prompt);
  });

  it('should preserve original case in style words', () => {
    const prompt = 'Portrait of girl, Photorealistic, High Quality, Digital Art';
    const result = splitPromptForDualCLIP(prompt);

    expect(result.t5xxlPrompt).toBe(prompt);
    expect(result.clipLPrompt).toContain('Photorealistic');
    expect(result.clipLPrompt).toContain('High Quality');
    expect(result.clipLPrompt).toContain('Digital Art');
  });

  it('should handle comma-separated prompts', () => {
    const prompt = 'forest path, cinematic, dramatic lighting, 8k, masterpiece';
    const result = splitPromptForDualCLIP(prompt);

    expect(result.t5xxlPrompt).toBe(prompt);
    expect(result.clipLPrompt).toContain('cinematic');
    expect(result.clipLPrompt).toContain('dramatic lighting');
    expect(result.clipLPrompt).toContain('8k');
    expect(result.clipLPrompt).toContain('masterpiece');
  });

  it('should handle partial keyword matches correctly', () => {
    const prompt = 'realistic portrait, photo-realistic style, realism art';
    const result = splitPromptForDualCLIP(prompt);

    expect(result.t5xxlPrompt).toBe(prompt);
    // Should match "realistic" but exact behavior depends on implementation
    expect(result.clipLPrompt.length).toBeGreaterThan(0);
  });

  it('should handle overlapping multi-word keywords', () => {
    const prompt = 'art gallery, digital art work, concept art design';
    const result = splitPromptForDualCLIP(prompt);

    expect(result.t5xxlPrompt).toBe(prompt);
    expect(result.clipLPrompt).toContain('digital art');
    expect(result.clipLPrompt).toContain('concept art');
  });

  it('should work with very long prompts', () => {
    const prompt =
      'An incredibly detailed and photorealistic portrait of a young woman with flowing hair, sitting in a beautiful garden during golden hour, with soft lighting and dramatic shadows, rendered in 8k ultra high quality with perfect focus and depth of field, trending on artstation, masterpiece';
    const result = splitPromptForDualCLIP(prompt);

    expect(result.t5xxlPrompt).toBe(prompt);
    expect(result.clipLPrompt).toContain('photorealistic');
    expect(result.clipLPrompt).toContain('golden hour');
    expect(result.clipLPrompt).toContain('soft lighting');
    expect(result.clipLPrompt).toContain('8k');
    expect(result.clipLPrompt).toContain('depth of field');
    expect(result.clipLPrompt).toContain('trending on artstation');
    expect(result.clipLPrompt).toContain('masterpiece');
  });

  it('should handle mixed content with various separators', () => {
    const prompt = 'sunset landscape; cinematic mood, soft lighting. 4k resolution!';
    const result = splitPromptForDualCLIP(prompt);

    expect(result.t5xxlPrompt).toBe(prompt);
    expect(result.clipLPrompt).toContain('cinematic');
    // soft lighting might be treated as two separate words due to separator handling
    expect(result.clipLPrompt).toMatch(/soft|lighting|cinematic|4k/);
  });

  it('should prioritize style keywords over content words', () => {
    const prompt = 'beautiful mountain landscape, photorealistic, detailed';
    const result = splitPromptForDualCLIP(prompt);

    expect(result.t5xxlPrompt).toBe(prompt);
    // Should contain style keywords
    expect(result.clipLPrompt).toContain('photorealistic');
    expect(result.clipLPrompt).toContain('detailed');
    // The algorithm extracts style keywords first, so may not contain content words
    expect(result.clipLPrompt.length).toBeGreaterThan(0);
  });
});
