import { describe, expect, it } from 'vitest';

import { createAgentSignalSkillLanguageInstruction } from './languageInstruction';

describe('agent signal skill language instruction', () => {
  /**
   * @example
   * Create defaults to responseLanguage when evidence does not imply a better language.
   */
  it('renders create instruction with response language default', () => {
    expect(
      createAgentSignalSkillLanguageInstruction({
        mode: 'create',
        responseLanguage: 'zh-CN',
      }),
    ).toContain(
      'Default to zh-CN when the source evidence does not imply a better artifact language.',
    );
  });

  /**
   * @example
   * Refine preserves existing skill language.
   */
  it('renders refine instruction with existing language preservation', () => {
    expect(
      createAgentSignalSkillLanguageInstruction({
        existingSkillLanguage: 'English',
        mode: 'refine',
        responseLanguage: 'zh-CN',
      }),
    ).toContain('Preserve the existing skill primary language: English.');
  });

  /**
   * @example
   * Domain target language beats UI language for work products.
   */
  it('documents domain target language over UI language', () => {
    expect(
      createAgentSignalSkillLanguageInstruction({
        mode: 'create',
        responseLanguage: 'zh-CN',
      }),
    ).toContain(
      'English academic writing skill under Chinese UI should keep the reusable writing artifact in English',
    );
  });
});
