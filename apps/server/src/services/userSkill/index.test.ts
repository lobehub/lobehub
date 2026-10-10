import { describe, expect, it } from 'vitest';

import { isUserSkillIdentifier, toRuntimeSkill } from './index';

const skill = {
  content: '---\nname: migrate-slice\ndescription: Move one slice\n---\nDo it.',
  createdAt: new Date(),
  description: 'Move one slice',
  files: [] as { content: string; language?: string; path: string }[],
  id: 'docs_1',
  name: 'migrate-slice',
  title: 'Migrate a slice',
  updatedAt: new Date(),
  version: 2,
};

describe('toRuntimeSkill', () => {
  it('names a library skill under the user-skills prefix', () => {
    const runtime = toRuntimeSkill(skill);
    expect(runtime).toMatchObject({
      content: skill.content,
      identifier: 'user-skills:migrate-slice',
      name: 'user-skills:migrate-slice',
      title: 'Migrate a slice',
    });
    expect(runtime.resources).toBeUndefined();
    expect(isUserSkillIdentifier(runtime.identifier)).toBe(true);
  });

  it('serves scripts as resources and lists them after SKILL.md when injected', () => {
    const runtime = toRuntimeSkill({
      ...skill,
      files: [{ content: 'echo ok', language: 'bash', path: 'scripts/check.sh' }],
    });
    expect(runtime.body).toBe(skill.content);
    expect(runtime.resources?.['scripts/check.sh']).toMatchObject({ content: 'echo ok', size: 7 });
    expect(runtime.content).toContain('check.sh');
    expect(runtime.content).toContain('readReference');
    expect(runtime.content.startsWith(skill.content)).toBe(true);
  });
});
