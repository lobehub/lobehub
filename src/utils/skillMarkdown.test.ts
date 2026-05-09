import { describe, expect, it, vi } from 'vitest';

import {
  composeSkillMarkdown,
  getSkillMarkdownMetadataError,
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

  it('recomposes frontmatter with the edited body', () => {
    expect(composeSkillMarkdown('name: skill-name', '# Updated')).toBe(`---
name: skill-name
---

# Updated`);
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
    expect(getSkillMarkdownMetadataError('name: skill-name')).toEqual({
      type: 'descriptionRequired',
    });
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
