import { describe, expect, it, vi } from 'vitest';

import { ConnectorDataError } from '../errors';
import { createNotionConnectorClient } from './client';

const createClient = (
  execute: ReturnType<typeof vi.fn>,
  resolveVersion: ReturnType<typeof vi.fn> = vi.fn(async () => ({ version: '20260730_00' })),
) =>
  createNotionConnectorClient({
    composio: { tools: { execute, getRawComposioToolBySlug: resolveVersion } },
    connectedAccountId: 'notion-account',
    userId: 'notion-owner',
  });

/** @example The Notion connector executes only bounded, version-pinned read operations. */
describe('createNotionConnectorClient', () => {
  /** @example Workspace directory and page Markdown calls use their documented Composio inputs. */
  it('lists workspace items and reads page Markdown', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          results: [
            {
              id: 'page-1',
              object: 'page',
              properties: { Name: { title: [{ plain_text: 'Roadmap' }] } },
            },
          ],
        },
        successful: true,
      })
      .mockResolvedValueOnce({ data: { markdown: '# Roadmap' }, successful: true });
    const client = createClient(execute);

    await expect(client.listItems({ maxResults: 500 })).resolves.toHaveLength(1);
    await expect(client.getPageMarkdown('page-1')).resolves.toBe('# Roadmap');
    expect(execute).toHaveBeenNthCalledWith(1, 'NOTION_FETCH_DATA', {
      arguments: {
        get_all: true,
        get_databases: true,
        get_pages: true,
        page_size: 50,
      },
      connectedAccountId: 'notion-account',
      userId: 'notion-owner',
      version: '20260730_00',
    });
    expect(execute).toHaveBeenNthCalledWith(2, 'NOTION_GET_PAGE_MARKDOWN', {
      arguments: { page_id: 'page-1' },
      connectedAccountId: 'notion-account',
      userId: 'notion-owner',
      version: '20260730_00',
    });
  });

  /** @example Each Notion tool resolves and caches its own explicit version. */
  it('caches tool versions independently by slug', async () => {
    const resolveVersion = vi.fn(async () => ({ version: '20260730_00' }));
    const execute = vi.fn(async (toolSlug: string) =>
      toolSlug === 'NOTION_FETCH_DATA'
        ? { data: { results: [] }, successful: true }
        : { data: { markdown: '# Page' }, successful: true },
    );
    const client = createClient(execute, resolveVersion);

    await client.listItems();
    await client.listItems();
    await client.getPageMarkdown('page-1');
    await client.getPageMarkdown('page-2');

    expect(resolveVersion.mock.calls).toEqual([
      ['NOTION_FETCH_DATA'],
      ['NOTION_GET_PAGE_MARKDOWN'],
    ]);
  });

  /** @example Failed tool executions expose sanitized connector errors without account details. */
  it('sanitizes Composio execution failures', async () => {
    const client = createClient(
      vi.fn(async () => ({ error: 'token=secret notion-account', successful: false })),
    );

    const error = await client.listItems().catch((reason) => reason);
    expect(error).toBeInstanceOf(ConnectorDataError);
    expect(error).toMatchObject({ operation: 'listItems', provider: 'notion', retryable: false });
    expect(error.message).not.toMatch(/secret|notion-account/);
  });
});
