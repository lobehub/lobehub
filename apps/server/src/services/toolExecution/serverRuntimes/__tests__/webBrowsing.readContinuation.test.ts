// @vitest-environment node
import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agents, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { agentDocumentsRuntime } from '../agentDocuments';
import { webBrowsingRuntime } from '../webBrowsing';

/**
 * T-14186: a crawled page longer than the crawl window is saved as an agent document, and the
 * window ends with the `readDocument` call that continues it. The offset in that call must count
 * lines of the text `readDocument` pages, not of the raw crawl, and reading past the end must
 * fail instead of returning an empty success.
 *
 * Drives the real server runtimes, document services and headless editor against PGlite; only
 * the crawler is stubbed.
 */

const crawl = vi.hoisted(() => ({ pages: [] as { content: string; url: string }[] }));

vi.mock('@/server/services/search', () => ({
  SearchService: vi.fn(function () {
    return {
      crawlPages: async () => ({
        results: crawl.pages.map(({ content, url }) => ({
          crawler: 'naive',
          data: { content, contentType: 'text', title: 'Paper', url },
          originalUrl: url,
        })),
      }),
      webSearch: vi.fn(),
    };
  }),
}));

vi.mock('@/server/services/search/userChannels', () => ({
  getUserChannelPreferences: async () => undefined,
}));

const userId = 'user-t14186';
const agentId = 'agt-t14186';
const url = 'https://example.com/papers/event-sourcing';

/**
 * Crawler Markdown keeps runs of blank lines between blocks; the saved snapshot collapses each
 * run to one, so the stored document has about half the raw page's lines.
 */
const rawPaper = Array.from(
  { length: 500 },
  (_, i) => `Paragraph ${i + 1}: events are the source of truth and state is a left fold.\n\n\n\n`,
).join('');

let serverDB: LobeChatDatabase;

const context = () => ({
  agentId,
  enabledToolIds: [AgentDocumentsIdentifier, WebBrowsingManifest.identifier],
  serverDB,
  toolManifestMap: {},
  userId,
});

const NOTICE_PATTERN =
  /\[Showing lines 1-(\d+) of (\d+) lines, \d+ characters\. To continue, call lobe-agent-documents readDocument with id="([^"]+)", format="markdown" and offset=(\d+)\.\]/;

describe('crawled page continuation through readDocument', () => {
  beforeEach(async () => {
    serverDB = await getTestDB();
    await serverDB.insert(users).values({ id: userId }).onConflictDoNothing();
    await serverDB.insert(agents).values({ id: agentId, slug: agentId, userId });
    crawl.pages = [{ content: rawPaper, url }];
  });

  afterEach(async () => {
    await serverDB.delete(users).where(eq(users.id, userId));
  });

  it('continues at the next paragraph of the saved document', async () => {
    const browsing = await webBrowsingRuntime.factory(context());
    const crawled = await browsing.crawlMultiPages({ urls: [url] });

    const notice = crawled.content.match(NOTICE_PATTERN);
    expect(notice).not.toBeNull();
    const [, endLine, totalLines, id, offset] = notice!;
    const lastShown = crawled.content
      .slice(0, crawled.content.indexOf(notice![0]))
      .trimEnd()
      .split('\n')
      .at(-1);
    const lastParagraph = Number(lastShown?.match(/^Paragraph (\d+):/)?.[1]);
    expect(Number(offset)).toBe(Number(endLine) + 1);

    const documents = agentDocumentsRuntime.factory(context());
    const next = await documents.readDocument(
      { format: 'markdown', id, limit: 3, offset: Number(offset) },
      { agentId },
    );

    expect(next.success).toBe(true);
    expect(next.content).toContain(`Paragraph ${lastParagraph + 1}:`);
    expect(next.content).not.toContain(`Paragraph ${lastParagraph}:`);
    expect(next.content).toContain(` of ${totalLines} lines,`);
  });

  it('fails a read past the end with the size the crawl reported', async () => {
    const browsing = await webBrowsingRuntime.factory(context());
    const crawled = await browsing.crawlMultiPages({ urls: [url] });
    const [, , totalLines, id] = crawled.content.match(NOTICE_PATTERN)!;

    const documents = agentDocumentsRuntime.factory(context());
    const pastEnd = await documents.readDocument(
      { format: 'markdown', id, limit: 130, offset: Number(totalLines) + 1 },
      { agentId },
    );

    expect(pastEnd.success).toBe(false);
    expect(pastEnd.content).toContain(`its markdown text has ${totalLines} lines,`);
    expect(pastEnd.content).not.toContain('Paragraph');
  });
});
