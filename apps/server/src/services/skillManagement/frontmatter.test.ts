import { describe, expect, it } from 'vitest';

import {
  normalizeSkillIndexContent,
  parseSkillFrontmatter,
  validateSkillName,
} from './frontmatter';

describe('validateSkillName', () => {
  it('accepts lowercase hyphenated skill names', () => {
    expect(validateSkillName('pr-review-checklist')).toBe('pr-review-checklist');
    expect(validateSkillName('skill-1')).toBe('skill-1');
  });

  it('rejects path-like skill names', () => {
    expect(() => validateSkillName('../secret')).toThrow('Invalid skill name');
    expect(() => validateSkillName('skill/name')).toThrow('Invalid skill name');
    expect(() => validateSkillName('skill\\name')).toThrow('Invalid skill name');
    expect(() => validateSkillName('SkillName')).toThrow('Invalid skill name');
  });

  it('rejects empty and too-long skill names', () => {
    expect(() => validateSkillName('')).toThrow('Invalid skill name');
    expect(() => validateSkillName('a'.repeat(81))).toThrow('Invalid skill name');
  });
});

describe('parseSkillFrontmatter', () => {
  it('parses name and description', () => {
    expect(
      parseSkillFrontmatter('---\nname: old-name\ndescription: Old description\n---\nBody'),
    ).toEqual({ description: 'Old description', name: 'old-name' });
  });

  it('parses YAML descriptions with quotes, colons, block scalars, and CRLF', () => {
    expect(
      parseSkillFrontmatter('---\r\nname: old-name\r\ndescription: "Review: PRs"\r\n---\r\nBody'),
    ).toEqual({ description: 'Review: PRs', name: 'old-name' });

    expect(
      parseSkillFrontmatter('---\nname: old-name\ndescription: "Review pull requests"\n---\nBody'),
    ).toEqual({ description: 'Review pull requests', name: 'old-name' });
  });

  it('rejects missing frontmatter', () => {
    expect(() =>
      parseSkillFrontmatter('name: old-name\ndescription: Old description\nBody'),
    ).toThrow('Skill index content must start with frontmatter');
  });

  it('rejects missing description', () => {
    expect(() => parseSkillFrontmatter('---\nname: old-name\n---\nBody')).toThrow(
      'Skill frontmatter description is required',
    );
  });

  it('rejects multiline parsed descriptions', () => {
    expect(() =>
      parseSkillFrontmatter('---\nname: old-name\ndescription: |\n  Line 1\n  Line 2\n---\nBody'),
    ).toThrow('Skill frontmatter description must be a single-line scalar');
  });
});

describe('normalizeSkillIndexContent', () => {
  it('rewrites the frontmatter name from the bundle filename and keeps the body', () => {
    expect(
      normalizeSkillIndexContent({
        bundleName: 'new-name',
        content: '---\nname: old-name\ndescription: Keep me\n---\n# Body\n- Step',
      }),
    ).toBe('---\nname: new-name\ndescription: Keep me\n---\n# Body\n- Step');
  });

  it('uses explicit description when provided', () => {
    expect(
      normalizeSkillIndexContent({
        bundleName: 'new-name',
        content: '---\nname: old-name\ndescription: Old\n---\nBody',
        description: 'New description',
      }),
    ).toBe('---\nname: new-name\ndescription: New description\n---\nBody');
  });

  it('rewrites stale invalid frontmatter name from the canonical bundle filename', () => {
    expect(
      parseSkillFrontmatter(
        normalizeSkillIndexContent({
          bundleName: 'new-name',
          content: '---\nname: Old Skill\ndescription: Keep me\n---\nBody',
        }),
      ),
    ).toEqual({ description: 'Keep me', name: 'new-name' });
  });

  it('rejects multiline description overrides before writing frontmatter', () => {
    expect(() =>
      normalizeSkillIndexContent({
        bundleName: 'new-name',
        content: '---\nname: old-name\ndescription: Old\n---\nBody',
        description: 'Injected\nname: other-name',
      }),
    ).toThrow('Skill frontmatter description must be a single-line scalar');
  });

  it('rejects blank description overrides instead of falling back', () => {
    expect(() =>
      normalizeSkillIndexContent({
        bundleName: 'new-name',
        content: '---\nname: old-name\ndescription: Old\n---\nBody',
        description: '   ',
      }),
    ).toThrow('Skill frontmatter description is required');
  });
});
