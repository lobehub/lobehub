import type { ChannelPublicMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { TimelineItem } from './joinEvents';
import { channelTimeFormatters, presentChannelTimeline } from './messagePresentation';

const message = (at: Date, patch: Partial<ChannelPublicMessage> = {}): TimelineItem => ({
  kind: 'message',
  message: {
    author: { avatar: null, id: 'alice', name: 'Alice', type: 'user' },
    createdAt: at,
    replyToId: null,
    threadId: null,
    ...patch,
  } as ChannelPublicMessage,
});

describe('channel reading groups', () => {
  const at = new Date(2026, 9, 31, 12);
  const later = (minutes: number) => new Date(at.getTime() + minutes * 60_000);

  it('keeps consecutive speech together but starts a fresh group after a pause', () => {
    const rows = presentChannelTimeline([message(at), message(later(1)), message(later(7))]);
    expect(rows.map((row) => row.continuation)).toEqual([false, true, false]);
    expect(rows.map((row) => row.startsDay)).toEqual([true, false, false]);
  });

  it('does not merge different identities, deleted authors, or distinct replies', () => {
    const variations: Partial<ChannelPublicMessage>[] = [
      { author: { avatar: null, id: 'bob', name: 'Alice', type: 'user' } },
      { author: { avatar: null, id: 'alice', name: 'Alice', type: 'agent' } },
      { author: { avatar: null, id: null, name: 'Deleted', type: 'user' } },
      { replyToId: 'another-request' },
      { threadId: 'another-thread' },
    ];
    for (const patch of variations) {
      expect(presentChannelTimeline([message(at), message(later(1), patch)])[1].continuation).toBe(
        false,
      );
    }
  });

  it('breaks a group around join events and at local midnight', () => {
    const event: TimelineItem = {
      event: { at: later(1).getTime(), id: 'join:bob', members: [] },
      kind: 'event',
    };
    expect(presentChannelTimeline([message(at), event, message(later(2))])[2].continuation).toBe(
      false,
    );
    const midnight = presentChannelTimeline([
      message(new Date(2026, 9, 31, 23, 59)),
      message(new Date(2026, 10, 1, 0, 1)),
    ]);
    expect(midnight[1]).toMatchObject({ continuation: false, startsDay: true });
  });

  it('does not group out-of-order messages or a first message on an older page', () => {
    expect(presentChannelTimeline([message(later(1)), message(at)])[1].continuation).toBe(false);
    expect(presentChannelTimeline([message(at)])[0].continuation).toBe(false);
  });
});

describe('channel timestamps', () => {
  const date = new Date(2026, 9, 31, 15, 4);

  it('uses the requested language for calendar labels and stable clock times', () => {
    const zh = channelTimeFormatters('zh-CN');
    const en = channelTimeFormatters('en-US');
    expect(zh.date.format(date)).toBe('2026年10月31日');
    expect(zh.time.format(date)).toBe('15:04');
    expect(en.date.format(date)).toBe('October 31, 2026');
    expect(en.time.format(date)).toMatch(/03:04\sPM/);
    expect(zh.full.format(date)).toContain('2026年10月31日');
  });
});
