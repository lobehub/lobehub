import { describe, expect, it } from 'vitest';

import { getSystemPromptForShareVisitor, systemPrompt } from './systemRole';

describe('builtin-tool-activator systemRole', () => {
  it('includes upfront batch activation, skill activation, and skill store discovery in default prompt', () => {
    expect(systemPrompt).toContain('activateTools');
    expect(systemPrompt).toContain('<available_tools>');
    expect(systemPrompt).toContain('reason');
    expect(systemPrompt).toContain('activateSkill');
    expect(systemPrompt).toContain('<selected_skill_context>');
    expect(systemPrompt).toContain('<skill_store_discovery>');
    expect(systemPrompt).toContain('lobe-skill-store');
  });

  it('gates Skill Store activation on availability and directs active stores to their API', () => {
    expect(systemPrompt).toContain('If lobe-skill-store is in <available_tools>, activate it');
    expect(systemPrompt).toContain('If already active, call it directly.');
  });

  it('omits skill store discovery for share visitors and gates activateSkill on withSkills', () => {
    const withoutSkills = getSystemPromptForShareVisitor({ withSkills: false });
    expect(withoutSkills).toContain('activateTools');
    expect(withoutSkills).not.toContain('lobe-skill-store');
    expect(withoutSkills).not.toContain('<skill_store_discovery>');
    expect(withoutSkills).not.toContain('activateSkill');

    const withSkills = getSystemPromptForShareVisitor({ withSkills: true });
    expect(withSkills).toContain('activateTools');
    expect(withSkills).toContain('activateSkill');
    expect(withSkills).toContain('<selected_skill_context>');
    expect(withSkills).not.toContain('lobe-skill-store');
    expect(withSkills).not.toContain('<skill_store_discovery>');
  });
});
