import { describe, expect, it } from 'vitest';

import { shownSkillFile, skillFileTree } from './skillFileTree';

describe('skillFileTree', () => {
  it('nests a skill’s files into folders, folders first', () => {
    expect(
      skillFileTree([
        { content: 'b', path: 'scripts/rollback.sql' },
        { content: 'notes', path: 'README.md' },
        { content: 'a', path: 'scripts/check.sh' },
      ]),
    ).toEqual([
      {
        children: [
          { content: 'a', name: 'check.sh', path: 'scripts/check.sh', type: 'file' },
          { content: 'b', name: 'rollback.sql', path: 'scripts/rollback.sql', type: 'file' },
        ],
        name: 'scripts',
        path: 'scripts',
        type: 'directory',
      },
      { content: 'notes', name: 'README.md', path: 'README.md', type: 'file' },
    ]);
  });

  it('is empty for a skill with no files', () => {
    expect(skillFileTree(undefined)).toEqual([]);
  });
});

describe('shownSkillFile', () => {
  const v2 = [{ path: 'scripts/check-pr.sh' }, { path: 'references/replica-read.md' }];

  it('keeps the file the reader picked while the version ships it', () => {
    expect(shownSkillFile('scripts/check-pr.sh', v2)).toBe('scripts/check-pr.sh');
  });

  // Picked in v2, then v1 opened: v1 has no such file, so its SKILL.md shows.
  it('falls back to SKILL.md in a version without the picked file', () => {
    expect(shownSkillFile('scripts/check-pr.sh', [])).toBe('SKILL.md');
    expect(shownSkillFile('SKILL.md', [])).toBe('SKILL.md');
  });
});
