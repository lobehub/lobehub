import { describe, expect, it } from 'vitest';

import { chainGenerateSkillMeta, GENERATE_SKILL_META_SCHEMA } from '../generateSkillMeta';

describe('chainGenerateSkillMeta', () => {
  const baseParams = {
    content: '# Weekly Report\n\nSummarize the week and highlight blockers.',
    responseLanguage: 'zh-CN',
  };

  it('instructs the model to emit name / title / description', () => {
    const payload = chainGenerateSkillMeta(baseParams);
    const system = (payload.messages?.[0] as { content: string }).content;

    expect(system).toMatch(/"name"/);
    expect(system).toMatch(/"title"/);
    expect(system).toMatch(/"description"/);
    // The description must describe WHEN to use the skill, not just restate the title.
    expect(system).toMatch(/WHEN the agent should use it/i);
  });

  it('keeps name ASCII kebab-case regardless of the document language', () => {
    const payload = chainGenerateSkillMeta(baseParams);
    const system = (payload.messages?.[0] as { content: string }).content;

    expect(system).toMatch(/kebab-case/i);
    expect(system).toContain('zh-CN');
    expect(system).toMatch(/name.*always.*ASCII/i);
  });

  it('embeds the document content in the user message', () => {
    const payload = chainGenerateSkillMeta(baseParams);
    const user = (payload.messages?.[1] as { content: string }).content;

    expect(user).toContain('Summarize the week and highlight blockers.');
  });
});

describe('GENERATE_SKILL_META_SCHEMA', () => {
  it('requires name, title, and description', () => {
    expect(GENERATE_SKILL_META_SCHEMA.schema.required).toEqual(['name', 'title', 'description']);
    expect(Object.keys(GENERATE_SKILL_META_SCHEMA.schema.properties).sort()).toEqual([
      'description',
      'name',
      'title',
    ]);
  });
});
