// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { SkillMountPathResolver } from './SkillMountPathResolver';

describe('SkillMountPathResolver', () => {
  it('resolves agent skill root paths', () => {
    expect(
      SkillMountPathResolver.resolve('./lobe/skills/agent/skills/research-paper/SKILL.md'),
    ).toEqual({
      filePath: 'SKILL.md',
      namespace: 'agent',
      relativePath: 'research-paper/SKILL.md',
      skillName: 'research-paper',
    });
  });

  it('resolves installed active directories', () => {
    expect(SkillMountPathResolver.resolve('./lobe/skills/installed/active/skills')).toEqual({
      namespace: 'installed-active',
      relativePath: '',
    });
  });

  it('rejects non-skill paths', () => {
    expect(() => SkillMountPathResolver.resolve('./documents/lobe/agent/rules.md')).toThrow(
      'Not a skill VFS path',
    );
    expect(() => SkillMountPathResolver.resolve('./documents/lobe/agent/rules.md')).toThrowError(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    );
  });

  it('rejects traversal segments', () => {
    expect(() =>
      SkillMountPathResolver.resolve('./lobe/skills/agent/skills/research-paper/../other/SKILL.md'),
    ).toThrow('Not a skill VFS path');
  });

  it('treats trailing slash paths as directories', () => {
    expect(SkillMountPathResolver.resolve('./lobe/skills/agent/skills/research-paper/')).toEqual({
      namespace: 'agent',
      relativePath: 'research-paper',
      skillName: 'research-paper',
    });
  });

  it('rejects repeated separators in file paths', () => {
    expect(() =>
      SkillMountPathResolver.resolve('./lobe/skills/agent/skills/research-paper//SKILL.md'),
    ).toThrow('Not a skill VFS path');
  });

  it('rejects repeated separators immediately after a namespace prefix', () => {
    expect(() =>
      SkillMountPathResolver.resolve('./lobe/skills/agent/skills//research-paper/SKILL.md'),
    ).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
  });

  it('rejects malformed paths in the guard helper', () => {
    expect(
      SkillMountPathResolver.isSkillPath('./lobe/skills/agent/skills/research-paper/../other'),
    ).toBe(false);
  });
});
