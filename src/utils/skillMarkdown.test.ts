import { describe, expect, it, vi } from 'vitest';

import {
  composeSkillMarkdown,
  getSkillMarkdownMetadataError,
  isSkillMarkdownDocument,
  parseSkillMarkdownFrontmatter,
  parseSkillMarkdownFrontmatterFields,
  parseSkillMarkdownMetadata,
} from './skillMarkdown';

describe('skillMarkdown', () => {
  it('extracts SKILL.md frontmatter and body', () => {
    const content = `---
description: >-
  Use when given a YouTube video link.
name: youtube-comment-retrieval-workflow
---

# Workflow`;

    expect(parseSkillMarkdownFrontmatter(content)).toEqual({
      body: '# Workflow',
      frontmatter: `description: >-
  Use when given a YouTube video link.
name: youtube-comment-retrieval-workflow`,
    });
  });

  it('extracts SKILL.md frontmatter after a BOM or leading whitespace', () => {
    const content = `\uFEFF

  ---
description: Skill metadata
name: skill-name
---

# Workflow`;

    expect(parseSkillMarkdownFrontmatter(content)).toEqual({
      body: '# Workflow',
      frontmatter: `description: Skill metadata
name: skill-name`,
    });
  });

  it('keeps ordinary Markdown unchanged when frontmatter is absent', () => {
    const content = `

# Workflow`;

    expect(parseSkillMarkdownFrontmatter(content)).toEqual({ body: content });
  });

  it('parses folded YAML scalars for display without control markers', () => {
    expect(
      parseSkillMarkdownMetadata(`description: >-
  Use when given a YouTube video link
  and retrieve comments.
name: youtube-comment-retrieval-workflow`),
    ).toEqual([
      {
        key: 'description',
        value: 'Use when given a YouTube video link and retrieve comments.',
      },
      {
        key: 'name',
        value: 'youtube-comment-retrieval-workflow',
      },
    ]);
  });

  it('stringifies non-string metadata values for display', () => {
    expect(
      parseSkillMarkdownMetadata(`enabled: true
retries: 2
resources:
  - reference.md
optional:`),
    ).toEqual([
      { key: 'enabled', value: 'true' },
      { key: 'retries', value: '2' },
      { key: 'resources', value: '["reference.md"]' },
      { key: 'optional', value: '' },
    ]);
  });

  it('reads frontmatter fields used by the metadata editor', () => {
    expect(
      parseSkillMarkdownFrontmatterFields(`name: skill-name
description: >-
  Use when given a YouTube video link
  and retrieve comments.`),
    ).toEqual({
      description: 'Use when given a YouTube video link and retrieve comments.',
      name: 'skill-name',
    });
  });

  it('returns empty frontmatter fields for invalid or non-mapping YAML', () => {
    expect(parseSkillMarkdownFrontmatterFields('description: [')).toEqual({});
    expect(parseSkillMarkdownFrontmatterFields('- name')).toEqual({});
    expect(parseSkillMarkdownFrontmatterFields()).toEqual({});
  });

  it('recomposes frontmatter with the edited body', () => {
    expect(composeSkillMarkdown('name: skill-name', '# Updated')).toBe(`---
name: skill-name
---

# Updated`);
  });

  it('recomposes edge cases without duplicating spacing', () => {
    expect(composeSkillMarkdown(undefined, '# Body')).toBe('# Body');
    expect(composeSkillMarkdown('name: skill-name\n', '')).toBe(`---
name: skill-name
---
`);
    expect(composeSkillMarkdown('name: skill-name', '\n# Body')).toBe(`---
name: skill-name
---

# Body`);
  });

  it('detects SKILL.md documents from document metadata', () => {
    expect(isSkillMarkdownDocument({ fileType: 'skills/index' })).toBe(true);
    expect(isSkillMarkdownDocument({ filename: 'SKILL.md' })).toBe(true);
    expect(isSkillMarkdownDocument({ title: 'SKILL.md' })).toBe(true);
    expect(isSkillMarkdownDocument({ filename: 'README.md' })).toBe(false);
  });

  it('returns an empty metadata list for invalid YAML', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(parseSkillMarkdownMetadata('description: [')).toEqual([]);

    consoleError.mockRestore();
  });

  it('validates editable YAML frontmatter', () => {
    expect(
      getSkillMarkdownMetadataError(`name: skill-name
description: Skill description`),
    ).toBeUndefined();
    expect(getSkillMarkdownMetadataError('')).toEqual({ type: 'required' });
    expect(getSkillMarkdownMetadataError('- name')).toEqual({ type: 'mapping' });
    expect(getSkillMarkdownMetadataError('description: [')).toEqual({ type: 'syntax' });
    expect(getSkillMarkdownMetadataError('description: Skill description')).toEqual({
      type: 'nameRequired',
    });
    expect(
      getSkillMarkdownMetadataError(`name: Skill Name
description: Skill description`),
    ).toEqual({ type: 'nameInvalid' });
    expect(
      getSkillMarkdownMetadataError(`name: 123
description: Skill description`),
    ).toEqual({ type: 'nameInvalid' });
    expect(getSkillMarkdownMetadataError('name: skill-name')).toEqual({
      type: 'descriptionRequired',
    });
    expect(
      getSkillMarkdownMetadataError(`name: skill-name
description:
  - list item`),
    ).toEqual({ type: 'descriptionInvalid' });
    expect(
      getSkillMarkdownMetadataError(`name: skill-name
description: |
  Line 1
  Line 2`),
    ).toEqual({ type: 'descriptionInvalid' });
    expect(
      getSkillMarkdownMetadataError(
        `name: other-name
description: Skill description`,
        { expectedName: 'skill-name' },
      ),
    ).toEqual({ expectedName: 'skill-name', type: 'nameLocked' });
  });
});
