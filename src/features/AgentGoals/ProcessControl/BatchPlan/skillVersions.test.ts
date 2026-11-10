import { describe, expect, it } from 'vitest';

import { skillVersionContent } from './skillVersions';

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
