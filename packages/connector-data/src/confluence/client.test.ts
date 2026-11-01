import { describe, expect, it, vi } from 'vitest';

import { confluenceStorageToText, createConfluenceConnectorClient } from './client';

// Shape recorded from a real Composio Confluence connection (trimmed).
const pagesResult = {
  data: {
    _links: { base: 'https://acme.atlassian.net/wiki' },
    results: [
      {
        _links: { webui: '/spaces/SD/pages/98333/Release+process' },
        body: { storage: { value: '<p>We release every second Thursday.</p>' } },
        id: '98333',
        title: 'Release process',
        version: { createdAt: '2026-10-17T11:20:00.000Z' },
      },
      {
        _links: { webui: '/spaces/~7120200da6/overview' },
        body: {},
        id: '65916',
        title: 'Overview',
      },
      { _links: { webui: '/spaces/%7Eada/pages/7/Notes' }, id: '7', title: 'Encoded personal' },
      { _links: { webui: '/pages/viewpage.action?pageId=8' }, id: '8', title: 'Unknown space' },
      { id: '1', title: 'No link' },
    ],
  },
  successful: true,
};

describe('createConfluenceConnectorClient', () => {
  it('reads recent pages with absolute URLs, space keys and plain text', async () => {
    const execute = vi.fn(async () => pagesResult);
    const client = createConfluenceConnectorClient({
      composio: { tools: { execute } },
      connectedAccountId: 'ca_conf',
      toolVersion: '20260915_00',
      userId: 'owner',
    });

    await expect(client.listRecentPages({ maxResults: 500 })).resolves.toEqual([
      {
        id: '98333',
        isPersonalSpace: false,
        spaceKey: 'SD',
        text: 'We release every second Thursday.',
        title: 'Release process',
        updatedAt: '2026-10-17T11:20:00.000Z',
        url: 'https://acme.atlassian.net/wiki/spaces/SD/pages/98333/Release+process',
      },
      {
        id: '65916',
        isPersonalSpace: true,
        spaceKey: '~7120200da6',
        text: undefined,
        title: 'Overview',
        updatedAt: undefined,
        url: 'https://acme.atlassian.net/wiki/spaces/~7120200da6/overview',
      },
      expect.objectContaining({ id: '7', isPersonalSpace: true, spaceKey: '~ada' }),
      // No space in the link: treated as personal so the default filter skips it.
      expect.objectContaining({ id: '8', isPersonalSpace: true, spaceKey: undefined }),
    ]);
    expect(execute.mock.calls[0][1].arguments).toEqual({
      body_format: 'storage',
      limit: 50,
      sort: '-modified-date',
      status: 'current',
    });
  });
});

describe('createConfluenceConnectorClient response shape', () => {
  it('reports an unexpected response instead of returning no pages', async () => {
    const client = createConfluenceConnectorClient({
      composio: {
        tools: { execute: vi.fn(async () => ({ data: { items: [] }, successful: true })) },
      },
      connectedAccountId: 'ca_conf',
      toolVersion: '20260915_00',
      userId: 'owner',
    });

    await expect(client.listRecentPages()).rejects.toMatchObject({
      code: 'confluence_response_invalid',
      provider: 'confluence',
    });
  });
});

describe('confluenceStorageToText', () => {
  it('drops macro settings and tags and decodes entities', () => {
    expect(
      confluenceStorageToText(
        '<ac:structured-macro ac:name="panel"><ac:parameter ac:name="bgColor">#E3FCEF</ac:parameter><ac:rich-text-body><p>Welcome &amp; hello&nbsp;team</p></ac:rich-text-body></ac:structured-macro><ul><li>One</li><li>Two</li></ul>',
      ),
    ).toBe('Welcome & hello team\nOne\nTwo');
    expect(confluenceStorageToText('<p> </p>')).toBeUndefined();
  });
});
