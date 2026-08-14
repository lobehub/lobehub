import { describe, expect, it } from 'vitest';

import { parseNotionItems, parseNotionPageMarkdown } from './parser';

/** @example Composio Notion responses become bounded, source-addressable evidence. */
describe('Notion response parsers', () => {
  /** @example Native page and database records retain titles, properties, edit times, and URLs. */
  it('normalizes wrapped Notion directory records', () => {
    expect(
      parseNotionItems(
        {
          data: {
            results: [
              {
                id: '12345678-1234-1234-1234-123456789abc',
                last_edited_time: '2026-08-01T00:00:00.000Z',
                object: 'page',
                properties: {
                  Name: { title: [{ plain_text: 'Launch plan' }], type: 'title' },
                  Status: { type: 'status' },
                },
              },
              {
                id: 'database-1',
                object: 'database',
                properties: {},
                title: [{ plain_text: 'Projects' }],
                url: 'https://www.notion.so/database-1',
              },
            ],
          },
          successful: true,
        },
        10,
      ),
    ).toEqual([
      {
        id: '12345678-1234-1234-1234-123456789abc',
        kind: 'page',
        lastEditedAt: '2026-08-01T00:00:00.000Z',
        propertyNames: ['Name', 'Status'],
        sourceUrl: 'https://www.notion.so/12345678123412341234123456789abc',
        title: 'Launch plan',
      },
      {
        id: 'database-1',
        kind: 'database',
        propertyNames: [],
        sourceUrl: 'https://www.notion.so/database-1',
        title: 'Projects',
      },
    ]);
  });

  /** @example A non-empty malformed collection is rejected instead of becoming empty evidence. */
  it('rejects a collection whose records cannot be normalized', () => {
    expect(parseNotionItems({ data: { results: [{ unexpected: true }] } }, 10)).toBeUndefined();
  });

  /** @example Nested page Markdown is extracted without exposing execution wrapper fields. */
  it('extracts nested Notion page Markdown', () => {
    expect(
      parseNotionPageMarkdown({ result: { data: { markdown: '# Launch\n- [ ] Ship' } } }),
    ).toBe('# Launch\n- [ ] Ship');
  });
});
