// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { ChannelRepository } from '..';
import { channelSearchSnippet, channelSearchTerms } from '../search';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-search');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const setup = async () => {
  const repo = new ChannelRepository(db, fixture.ownerId);
  const { channel } = await repo.create({ title: 'Planning' });
  const send = (content: string, requestKey: string, threadId?: string) =>
    repo.send(channel.id, { content, requestKey, routing: 'fallback', threadId });
  const root = await send('Should we ship the Search box on Friday?', 'root');
  const thread = await repo.createThread(channel.id, { rootMessageId: root.id });
  const reply = await send('Only after QA signs off the search', 'reply', thread.id);
  const other = await send('Lunch at noon', 'other');
  const wildcard = await send('Coverage is 100% now', 'wildcard');
  return { channel, other, reply, repo, root, thread, wildcard };
};

describe('ChannelRepository.searchMessages', () => {
  it('finds main and Thread messages case-insensitively, newest first', async () => {
    const { channel, reply, repo, root, thread } = await setup();
    const result = await repo.searchMessages(channel.id, { query: 'SEARCH' });

    expect(result.hasMore).toBe(false);
    expect(result.messages.map((m) => m.id)).toEqual([reply.id, root.id]);
    expect(result.messages[0]).toMatchObject({
      author: { id: fixture.ownerId, type: 'user' },
      threadId: thread.id,
    });
    expect(result.messages[1]).toMatchObject({ threadId: null, threadTitle: null });
  });

  it('requires every word and matches LIKE metacharacters literally', async () => {
    const { channel, repo, root, wildcard } = await setup();
    expect(
      (await repo.searchMessages(channel.id, { query: 'friday  search' })).messages.map(
        (m) => m.id,
      ),
    ).toEqual([root.id]);
    expect(
      (await repo.searchMessages(channel.id, { query: '100%' })).messages.map((m) => m.id),
    ).toEqual([wildcard.id]);
    expect((await repo.searchMessages(channel.id, { query: '_' })).messages).toEqual([]);
  });

  it('pages older results with `before`', async () => {
    const { channel, reply, repo, root } = await setup();
    const first = await repo.searchMessages(channel.id, { limit: 1, query: 'search' });
    expect(first).toMatchObject({ hasMore: true, messages: [{ id: reply.id }] });
    const next = await repo.searchMessages(channel.id, {
      before: first.messages[0].sequence,
      limit: 1,
      query: 'search',
    });
    expect(next).toMatchObject({ hasMore: false, messages: [{ id: root.id }] });
  });

  it('skips a trashed Thread', async () => {
    const { channel, repo, root, thread } = await setup();
    await repo.removeThread(channel.id, thread.id);
    expect(
      (await repo.searchMessages(channel.id, { query: 'search' })).messages.map((m) => m.id),
    ).toEqual([root.id]);
  });

  it('searches only one Thread when given its id', async () => {
    const { channel, reply, repo, thread } = await setup();
    const result = await repo.searchMessages(channel.id, { query: 'search', threadId: thread.id });
    expect(result).toMatchObject({ hasMore: false, messages: [{ id: reply.id }] });
    expect(result.messages).toHaveLength(1);
  });

  it('searches only the main timeline when `threadId` is null', async () => {
    const { channel, repo, root } = await setup();
    expect(
      (await repo.searchMessages(channel.id, { query: 'search', threadId: null })).messages.map(
        (m) => m.id,
      ),
    ).toEqual([root.id]);
  });

  it('pages a Thread-scoped search with `before`', async () => {
    const { channel, repo, reply, thread } = await setup();
    const send = (content: string, requestKey: string) =>
      repo.send(channel.id, { content, requestKey, routing: 'fallback', threadId: thread.id });
    const later = await send('Search results look right', 'later');
    // A newer main-timeline hit stays out of the Thread's pages.
    await repo.send(channel.id, {
      content: 'search again',
      requestKey: 'main',
      routing: 'fallback',
    });
    const first = await repo.searchMessages(channel.id, {
      limit: 1,
      query: 'search',
      threadId: thread.id,
    });
    expect(first).toMatchObject({ hasMore: true, messages: [{ id: later.id }] });
    const next = await repo.searchMessages(channel.id, {
      before: first.messages[0].sequence,
      limit: 1,
      query: 'search',
      threadId: thread.id,
    });
    expect(next).toMatchObject({ hasMore: false, messages: [{ id: reply.id }] });
  });

  it('finds nothing in a trashed Thread', async () => {
    const { channel, repo, thread } = await setup();
    await repo.removeThread(channel.id, thread.id);
    expect(
      (await repo.searchMessages(channel.id, { query: 'search', threadId: thread.id })).messages,
    ).toEqual([]);
  });

  it('hides a Channel the caller cannot read', async () => {
    const { channel } = await setup();
    const outsider = new ChannelRepository(db, fixture.memberId);
    await expect(outsider.searchMessages(channel.id, { query: 'search' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('channel search helpers', () => {
  it('splits and dedupes words', () => {
    expect(channelSearchTerms('  a  b a ')).toEqual(['a', 'b']);
    expect(channelSearchTerms('   ')).toEqual([]);
  });

  it('keeps a window around the first match', () => {
    const content = `${'x'.repeat(200)} needle ${'y'.repeat(300)}`;
    const snippet = channelSearchSnippet(content, ['NEEDLE']);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('needle');
    expect(channelSearchSnippet('short\n\ntext', ['zzz'])).toBe('short text');
  });
});
