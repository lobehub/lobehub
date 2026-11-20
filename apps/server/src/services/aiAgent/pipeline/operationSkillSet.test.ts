import { describe, expect, it } from 'vitest';

import { collectSelectedSkillIds } from './operationSkillSet';

describe('collectSelectedSkillIds', () => {
  it('keeps the skills earlier user turns selected and adds this turn’s', () => {
    const history = [
      { metadata: { selectedSkillIds: ['ux-audit'] }, role: 'user' },
      { metadata: null, role: 'assistant' },
      { metadata: { selectedSkillIds: ['agent-skills:review', 'ux-audit'] }, role: 'user' },
    ];

    expect(collectSelectedSkillIds(history, ['db-skill', 'ux-audit'])).toEqual([
      'ux-audit',
      'agent-skills:review',
      'db-skill',
    ]);
  });

  it('ignores selections on non-user rows and malformed metadata', () => {
    const history = [
      { metadata: { selectedSkillIds: ['from-assistant'] }, role: 'assistant' },
      { metadata: { selectedSkillIds: 'not-an-array' }, role: 'user' },
      { metadata: { selectedSkillIds: [42, 'kept'] }, role: 'user' },
      { role: 'user' },
    ];

    expect(collectSelectedSkillIds(history)).toEqual(['kept']);
  });
});
