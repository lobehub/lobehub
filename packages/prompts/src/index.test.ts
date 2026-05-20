import { describe, expect, it, vi } from 'vitest';

import * as chains from './chains';
import * as mainExports from './index';
import * as prompts from './prompts';

// Mock the problematic dependency
vi.mock('@/locales/resources', () => ({
  supportLocales: ['en-US', 'zh-CN'],
}));

describe('Main Index Export', () => {
  it('should export all chains', () => {
    expect(mainExports).toEqual(expect.objectContaining(chains));
  });

  it('should export all prompts', () => {
    expect(mainExports).toEqual(expect.objectContaining(prompts));
  });

  it('should have all expected chain exports', () => {
    const chainExports = [
      'chainAbstractChunkText',
      'chainAnswerWithContext',
      'chainLangDetect',
      'chainPickEmoji',
      'chainSummaryAgentName',
      'chainSummaryDescription',
      'chainSummaryGenerationTitle',
      'chainSummaryHistory',
      'chainSummaryTags',
      'chainSummaryTitle',
      'chainTranslate',
    ];

    chainExports.forEach((exportName) => {
      expect(mainExports).toHaveProperty(exportName);
    });
  });
});
