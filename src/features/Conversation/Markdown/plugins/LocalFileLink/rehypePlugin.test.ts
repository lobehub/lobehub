import { describe, expect, it, vi } from 'vitest';

import { LOBE_LOCAL_FILE_LINK_TAG } from './parse';
import { rehypeLocalFileLink } from './rehypePlugin';

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  isDesktop: true,
}));

const createAnchor = (href: string, text: string) => ({
  children: [{ type: 'text', value: text }],
  properties: { href },
  tagName: 'a',
  type: 'element',
});

describe('rehypeLocalFileLink', () => {
  it('rewrites absolute local file links into local file link nodes', () => {
    const anchor = createAnchor('/Users/me/project/src/Group.tsx:265', 'Group.tsx');
    const tree = { children: [anchor], type: 'root' };

    rehypeLocalFileLink()(tree);

    expect(anchor).toEqual({
      children: [],
      properties: {
        linkHref: '/Users/me/project/src/Group.tsx:265',
        linkLabel: 'Group.tsx',
      },
      tagName: LOBE_LOCAL_FILE_LINK_TAG,
      type: 'element',
    });
  });

  it('keeps regular app routes untouched', () => {
    const anchor = createAnchor('/settings/profile', 'settings');
    const tree = { children: [anchor], type: 'root' };

    rehypeLocalFileLink()(tree);

    expect(anchor.tagName).toBe('a');
    expect(anchor.properties).toEqual({ href: '/settings/profile' });
  });
});
