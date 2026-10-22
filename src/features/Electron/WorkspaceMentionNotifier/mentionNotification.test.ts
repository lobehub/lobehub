import { describe, expect, it } from 'vitest';

import {
  MAX_MENTION_BANNERS_PER_POLL,
  type MentionNotificationRow,
  pickNewMentions,
  toMentionNotificationParams,
} from './mentionNotification';

const row = (
  id: string,
  overrides: Partial<MentionNotificationRow> = {},
): MentionNotificationRow => ({
  actionUrl: null,
  content: `content ${id}`,
  id,
  title: `title ${id}`,
  ...overrides,
});

describe('pickNewMentions', () => {
  it('treats the first page of a workspace as a baseline', () => {
    const { fresh, seen } = pickNewMentions([row('b'), row('a')], undefined);

    expect(fresh).toEqual([]);
    expect([...seen]).toEqual(['b', 'a']);
  });

  it('announces only unseen rows, oldest first', () => {
    const { fresh, seen } = pickNewMentions(
      [row('d'), row('c'), row('b'), row('a')],
      new Set(['a', 'b']),
    );

    expect(fresh.map((item) => item.id)).toEqual(['c', 'd']);
    expect(seen.has('c') && seen.has('d')).toBe(true);
  });

  it('does not re-announce a row that was read and dropped off the unread page', () => {
    const first = pickNewMentions([row('b'), row('a')], new Set(['a']));
    const second = pickNewMentions([row('a')], first.seen);

    expect(first.fresh.map((item) => item.id)).toEqual(['b']);
    expect(second.fresh).toEqual([]);
  });

  it('caps a burst to the newest mentions', () => {
    const rows = ['e', 'd', 'c', 'b', 'a'].map((id) => row(id));
    const { fresh, seen } = pickNewMentions(rows, new Set());

    expect(fresh).toHaveLength(MAX_MENTION_BANNERS_PER_POLL);
    expect(fresh.map((item) => item.id)).toEqual(['c', 'd', 'e']);
    // The skipped ones still count as seen so the next poll doesn't announce them late.
    expect(seen.size).toBe(5);
  });
});

describe('toMentionNotificationParams', () => {
  it('uses the inbox title and a plain-text body', () => {
    const params = toMentionNotificationParams(
      row('a', { content: '**Alice**: can you check `this`?', title: 'Alice mentioned you' }),
      null,
    );

    expect(params.title).toBe('Alice mentioned you');
    expect(params.body).toBe('Alice: can you check this?');
    expect(params.force).toBeUndefined();
  });

  it('falls back to the context when the content is empty', () => {
    const params = toMentionNotificationParams(row('a', { content: '', context: 'Roadmap' }), null);

    expect(params.body).toBe('Roadmap');
  });

  it('caps a long body', () => {
    const params = toMentionNotificationParams(row('a', { content: 'x'.repeat(300) }), null);

    expect(params.body).toBe(`${'x'.repeat(256)}…`);
  });

  it('pins an in-app action url to the mention workspace', () => {
    const params = toMentionNotificationParams(
      row('a', { actionUrl: '/agent/agt_1/tpc_1' }),
      'acme',
    );

    expect(params.navigate).toEqual({ escape: true, path: '/acme/agent/agt_1/tpc_1' });
  });

  it('keeps an already-prefixed action url as is', () => {
    const params = toMentionNotificationParams(row('a', { actionUrl: '/acme/page/doc_1' }), 'acme');

    expect(params.navigate).toEqual({ escape: true, path: '/acme/page/doc_1' });
  });

  it('skips navigation for external or missing action urls', () => {
    expect(
      toMentionNotificationParams(row('a', { actionUrl: 'https://example.com/x' }), 'acme')
        .navigate,
    ).toBeUndefined();
    expect(toMentionNotificationParams(row('a'), 'acme').navigate).toBeUndefined();
  });
});
