import { describe, expect, it } from 'vitest';

import { createResourceContentPreview } from './resourceContentPreview';

describe('createResourceContentPreview', () => {
  it('returns a sanitized and bounded webpage preview', () => {
    const content = [
      '---',
      'name: private metadata',
      '---',
      '<scr<b>ipt>alert(1)</scr</b>ipt>',
      '[ ](<https://example.com/>) Real content here',
      '|:---|---:|',
      'x'.repeat(400),
    ].join('\n');

    const result = createResourceContentPreview({
      content,
      fileType: 'article',
      title: 'Example',
    });

    expect(result).toContain('Real content here');
    expect(result).not.toContain('private metadata');
    expect(result).not.toMatch(/[<>]/);
    expect(result).toHaveLength(240);
  });

  it('removes a duplicated page title and returns null for empty content', () => {
    expect(
      createResourceContentPreview({
        content: '# Project Plan\n\nFirst milestone',
        fileType: 'custom/document',
        title: 'Project Plan',
      }),
    ).toBe('First milestone');
    expect(
      createResourceContentPreview({ content: '', fileType: 'custom/document', title: 'Empty' }),
    ).toBeNull();
  });

  it.each([
    ['# Planetary notes', 'Planetary notes'],
    ['Planetary notes', 'Planetary notes'],
  ])('does not remove a non-matching or non-heading title prefix from %s', (content, expected) => {
    expect(
      createResourceContentPreview({
        content,
        fileType: 'custom/document',
        title: 'Plan',
      }),
    ).toBe(expected);
  });

  it.each([
    ['scalar', '---\nIntroduction\n---\nImportant body', 'Introduction Important body'],
    ['array', '---\n- first\n- second\n---\nImportant body', '- first - second Important body'],
    ['empty', '---\n---\nImportant body', 'Important body'],
    [
      'malformed',
      '---\nname: [unterminated\n---\nImportant body',
      'name: [unterminated Important body',
    ],
  ])('keeps %s YAML-shaped thematic-break content', (_kind, content, expected) => {
    expect(
      createResourceContentPreview({ content, fileType: 'text/markdown', title: 'Example' }),
    ).toBe(expected);
  });
});
