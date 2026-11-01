import { describe, expect, it, vi } from 'vitest';

import { collectConfluenceUnderstanding, confluenceUnderstandingProvider } from './confluence';

const pages = [
  {
    id: '1',
    isPersonalSpace: false,
    spaceKey: 'SD',
    text: 'We release every second Thursday.',
    title: 'Release process',
    url: 'https://acme.atlassian.net/wiki/spaces/SD/pages/1',
  },
  {
    id: '2',
    isPersonalSpace: true,
    spaceKey: '~ada',
    title: 'My notes',
    url: 'https://acme.atlassian.net/wiki/spaces/~ada/pages/2',
  },
];
const connectorData = {
  getConfluenceClient: vi.fn(async () => ({ listRecentPages: vi.fn(async () => pages) })),
} as never;

/** @example Confluence pages describe a team's processes and docs. */
describe('confluenceUnderstandingProvider', () => {
  it('keeps shared-space pages only by default', async () => {
    const result = await confluenceUnderstandingProvider.collect({
      connectorData,
      userId: 'user-1',
    });

    expect(result.context).toContain('Release process');
    expect(result.context).toContain(pages[0].url);
    expect(result.context).not.toContain('My notes');
    expect(result.sourceCount).toBe(1);
  });

  it('includes personal spaces when allowed', async () => {
    const result = await collectConfluenceUnderstanding({
      connectorData,
      includePersonalSpaces: true,
    });

    expect(result.context).toContain('My notes');
    expect(result.sourceCount).toBe(2);
  });
});
