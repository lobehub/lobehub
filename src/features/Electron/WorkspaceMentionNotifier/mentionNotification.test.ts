import { describe, expect, it } from 'vitest';

import {
  MAX_MENTION_BANNERS_PER_POLL,
  type MentionNotificationRow,
  pickNewMentions,
  toMentionNotificationParams,
} from './mentionNotification';

/** Ids sort by creation time: `a` is the oldest, one second apart. */
const createdAt = (id: string) => new Date(Date.UTC(2026, 0, 1, 0, 0, id.charCodeAt(0) - 96));

const row = (
  id: string,
  overrides: Partial<MentionNotificationRow> = {},
): MentionNotificationRow => ({
  actionUrl: null,
  content: `content ${id}`,
  createdAt: createdAt(id),
  id,
  title: `title ${id}`,
  ...overrides,
});

const ids = (rows: MentionNotificationRow[]) => rows.map((item) => item.id);

describe('pickNewMentions', () => {
  it('treats the first page of a workspace as a baseline', () => {
    const { fresh, watermark } = pickNewMentions([row('b'), row('a')], undefined);

    expect(fresh).toEqual([]);
    expect(watermark).toEqual({ createdAt: createdAt('b').getTime(), ids: new Set(['b']) });
  });

  it('announces only rows newer than the watermark, oldest first', () => {
    const baseline = pickNewMentions([row('b'), row('a')], undefined);
    const { fresh, watermark } = pickNewMentions(
      [row('d'), row('c'), row('b'), row('a')],
      baseline.watermark,
    );

    expect(ids(fresh)).toEqual(['c', 'd']);
    expect(watermark.createdAt).toBe(createdAt('d').getTime());
  });

  it('announces the first mention after an empty baseline', () => {
    const baseline = pickNewMentions([], undefined);
    const { fresh } = pickNewMentions([row('a')], baseline.watermark);

    expect(ids(fresh)).toEqual(['a']);
  });

  it('does not re-announce a row that was read and dropped off the unread page', () => {
    const first = pickNewMentions(
      [row('b'), row('a')],
      pickNewMentions([row('a')], undefined).watermark,
    );
    const second = pickNewMentions([row('a')], first.watermark);

    expect(ids(first.fresh)).toEqual(['b']);
    expect(second.fresh).toEqual([]);
  });

  it('does not announce older unread mentions that scroll into the page', () => {
    // Baseline page holds the newest two; `a` sits beyond the page size.
    const baseline = pickNewMentions([row('c'), row('b')], undefined);
    // `c` is read, so the older unread `a` now fits on the page.
    const { fresh, watermark } = pickNewMentions([row('b'), row('a')], baseline.watermark);

    expect(fresh).toEqual([]);
    expect(watermark).toEqual(baseline.watermark);
  });

  it('tells apart mentions that share the watermark timestamp', () => {
    const sameTime = { createdAt: createdAt('b') };
    const baseline = pickNewMentions([row('b1', sameTime)], undefined);
    const { fresh, watermark } = pickNewMentions(
      [row('b2', sameTime), row('b1', sameTime)],
      baseline.watermark,
    );

    expect(ids(fresh)).toEqual(['b2']);
    expect(watermark.ids).toEqual(new Set(['b1', 'b2']));
  });

  it('caps a burst to the newest mentions', () => {
    const baseline = pickNewMentions([], undefined);
    const rows = ['e', 'd', 'c', 'b', 'a'].map((id) => row(id));
    const { fresh, watermark } = pickNewMentions(rows, baseline.watermark);

    expect(fresh).toHaveLength(MAX_MENTION_BANNERS_PER_POLL);
    expect(ids(fresh)).toEqual(['c', 'd', 'e']);
    // The skipped ones sit below the watermark so the next poll doesn't announce them late.
    expect(pickNewMentions(rows, watermark).fresh).toEqual([]);
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

  it('skips navigation for protocol-relative or backslash action urls', () => {
    for (const actionUrl of ['//evil.example/x', '/\\evil.example/x']) {
      expect(toMentionNotificationParams(row('a', { actionUrl }), 'acme').navigate).toBeUndefined();
    }
  });
});
