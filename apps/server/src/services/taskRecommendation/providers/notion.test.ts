// @vitest-environment node
import type { NotionItem } from '@lobechat/connector-data/notion';
import { describe, expect, it, vi } from 'vitest';

import { createNotionTaskRecommendationProvider } from './notion';

const page = (overrides: Partial<NotionItem> = {}): NotionItem => ({
  id: 'page-1',
  kind: 'page',
  lastEditedAt: '2026-08-01T00:00:00.000Z',
  propertyNames: ['Name'],
  sourceUrl: 'https://www.notion.so/page-1',
  title: 'Launch plan',
  ...overrides,
});

/** @example Notion task signals remain read-only and grounded in exact page URLs. */
describe('createNotionTaskRecommendationProvider', () => {
  /** @example Unchecked tasks become a trusted recommendation signal and titled source. */
  it('collects open action items from page Markdown', async () => {
    const provider = createNotionTaskRecommendationProvider();
    const result = await provider.collect({
      connectorData: {
        getNotionClient: vi.fn(async () => ({
          getPageMarkdown: vi.fn(async () => '# Launch\n- [ ] Prepare release notes'),
          listItems: vi.fn(async () => [page()]),
        })),
      },
    } as never);

    expect(result).toMatchObject({
      diagnostics: { evidenceCount: 1, failedCount: 0 },
      signalCount: 1,
      sources: [
        {
          title: 'Launch plan',
          type: 'notion',
          url: 'https://www.notion.so/page-1',
        },
      ],
    });
    expect(result.context).toContain('open_action_items');
  });

  /** @example A recently edited page without action markers does not create generic busywork. */
  it('returns no signals for non-actionable page content', async () => {
    const provider = createNotionTaskRecommendationProvider();
    const result = await provider.collect({
      connectorData: {
        getNotionClient: vi.fn(async () => ({
          getPageMarkdown: vi.fn(async () => '# Team handbook\nWelcome to the team.'),
          listItems: vi.fn(async () => [page()]),
        })),
      },
    } as never);

    expect(result).toMatchObject({ signalCount: 0, sources: [] });
  });

  /** @example An entirely old authorized workspace becomes one coverage-first review. */
  it('adds a coverage-first generation policy when every visible item is stale', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T00:00:00.000Z'));

    try {
      const provider = createNotionTaskRecommendationProvider();
      const result = await provider.collect({
        connectorData: {
          getNotionClient: vi.fn(async () => ({
            getPageMarkdown: vi.fn(async () => '# Old plan\n- [ ] Ship the old milestone'),
            listItems: vi.fn(async () => [
              page({ lastEditedAt: '2021-08-30T00:00:00.000Z' }),
              page({
                id: 'page-2',
                lastEditedAt: '2022-01-01T00:00:00.000Z',
                sourceUrl: 'https://www.notion.so/page-2',
                title: 'Architecture notes',
              }),
            ]),
          })),
        },
      } as never);

      expect(result.recommendationLimit).toBe(1);
      expect(result.promptPrinciples).toEqual(
        expect.arrayContaining([
          expect.stringContaining('2 of 2 Notion items returned by the current bounded connector scan'),
          expect.stringContaining('Do not turn old TODOs'),
          expect.stringContaining('workspace, account, integration, page, and Teamspace access'),
        ]),
      );
      expect(result.context).toContain('"mode": "stale_dominant"');
      expect(result.context).toContain('"latestEditedAt": "2022-01-01T00:00:00.000Z"');
    } finally {
      vi.useRealTimers();
    }
  });

  /** @example A balanced current-and-old scan keeps normal content-oriented recommendation policy. */
  it('keeps normal recommendation policy when stale items are not dominant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T00:00:00.000Z'));

    try {
      const provider = createNotionTaskRecommendationProvider();
      const result = await provider.collect({
        connectorData: {
          getNotionClient: vi.fn(async () => ({
            getPageMarkdown: vi.fn(async () => '# Plan\n- [ ] Review the current milestone'),
            listItems: vi.fn(async () => [
              page({ lastEditedAt: '2021-08-30T00:00:00.000Z' }),
              page({
                id: 'page-2',
                lastEditedAt: '2026-08-01T00:00:00.000Z',
                sourceUrl: 'https://www.notion.so/page-2',
              }),
            ]),
          })),
        },
      } as never);

      expect(result.recommendationLimit).toBeUndefined();
      expect(result.promptPrinciples).toBeUndefined();
      expect(result.context).toContain('"mode": "mixed_or_current"');
    } finally {
      vi.useRealTimers();
    }
  });

  /** @example One recently touched hub does not make many old project pages look current. */
  it('adds coverage-first guidance when old items dominate a recently touched hub', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T00:00:00.000Z'));

    try {
      const provider = createNotionTaskRecommendationProvider();
      const stalePages = Array.from({ length: 9 }, (_, index) =>
        page({
          id: `old-page-${index}`,
          lastEditedAt: '2021-08-30T00:00:00.000Z',
          sourceUrl: `https://www.notion.so/old-page-${index}`,
          title: `Old project page ${index}`,
        }),
      );
      const result = await provider.collect({
        connectorData: {
          getNotionClient: vi.fn(async () => ({
            getPageMarkdown: vi.fn(async () => '# Project index'),
            listItems: vi.fn(async () => [
              page({
                id: 'recent-hub',
                lastEditedAt: '2026-08-01T00:00:00.000Z',
                sourceUrl: 'https://www.notion.so/recent-hub',
                title: 'Workspace hub',
              }),
              ...stalePages,
            ]),
          })),
        },
      } as never);

      expect(result.recommendationLimit).toBe(1);
      expect(result.promptPrinciples).toEqual(
        expect.arrayContaining([
          expect.stringContaining('9 of 10 Notion items'),
          expect.stringContaining('hub, index, or access-related page'),
        ]),
      );
      expect(result.context).toContain('"mode": "stale_dominant"');
      expect(result.context).toContain('"recentItemCount": 1');
      expect(result.context).toContain('"staleItemRatio": 0.9');
    } finally {
      vi.useRealTimers();
    }
  });

  /** @example Missing edit dates cannot prove that the bounded visible sample is entirely old. */
  it('does not infer stale-only policy when any visible item has unknown recency', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T00:00:00.000Z'));

    try {
      const provider = createNotionTaskRecommendationProvider();
      const result = await provider.collect({
        connectorData: {
          getNotionClient: vi.fn(async () => ({
            getPageMarkdown: vi.fn(async () => '# Plan\n- [ ] Review this item'),
            listItems: vi.fn(async () => [
              page({ lastEditedAt: '2021-08-30T00:00:00.000Z' }),
              page({
                id: 'page-2',
                lastEditedAt: undefined,
                sourceUrl: 'https://www.notion.so/page-2',
              }),
            ]),
          })),
        },
      } as never);

      expect(result.recommendationLimit).toBeUndefined();
      expect(result.promptPrinciples).toBeUndefined();
      expect(result.context).toContain('"mode": "mixed_or_current"');
    } finally {
      vi.useRealTimers();
    }
  });
});
