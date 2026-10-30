import { describe, expect, it } from 'vitest';

import { skillFileTree } from './skillFileTree';

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
