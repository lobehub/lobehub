import { describe, expect, it } from 'vitest';

import { readSkillVersion } from './helpers';

const skill = (frontmatter: string) => `---\n${frontmatter}\n---\n\n# Body\n`;

describe('readSkillVersion', () => {
  it('reads the version declared in the frontmatter', () => {
    expect(readSkillVersion(skill('name: acceptance\nversion: 1.2.3'))).toBe('1.2.3');
  });

  it('strips quotes so a YAML-quoted version is comparable', () => {
    expect(readSkillVersion(skill("name: acceptance\nversion: '2.0.0'"))).toBe('2.0.0');
  });

  it('returns undefined for a skill that declares no version', () => {
    // Every other builtin skill is unversioned today; that must stay legal.
    expect(readSkillVersion(skill('name: artifacts\ndescription: x'))).toBeUndefined();
  });

  it('ignores a version line nested inside a block scalar', () => {
    // `description: >` continuation lines are indented, and their prose can
    // easily contain "version:". Only a column-zero key is the real field.
    const content = skill(
      'name: acceptance\ndescription: >\n  Bump the version: 9.9.9 when asked.',
    );

    expect(readSkillVersion(content)).toBeUndefined();
  });

  it('returns undefined when there is no frontmatter at all', () => {
    expect(readSkillVersion('# Just a document\n\nversion: 1.0.0\n')).toBeUndefined();
  });
});
