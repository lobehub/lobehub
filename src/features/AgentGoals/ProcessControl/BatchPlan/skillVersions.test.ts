import { describe, expect, it } from 'vitest';

import { skillFileTree, skillVersionContent } from './skillVersions';

describe('skillVersionContent', () => {
  it('reads a kept version whole, frontmatter included', () => {
    const versions = [{ content: '---\nname: plan\n---\nv2 body', version: 2 }];
    expect(skillVersionContent(versions, 2)).toBe('---\nname: plan\n---\nv2 body');
    expect(skillVersionContent(versions, 3)).toBeUndefined();
  });

  it('has nothing to offer when the payload carries no versions', () => {
    expect(skillVersionContent(undefined, 1)).toBeUndefined();
  });
});

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
