import type { AcceptanceCommentItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { groupDiscussionByRound } from './discussionRounds';
import type { DiscussionEntry } from './discussionTimeline';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 10, 8, minute));
const message = (minute: number, id = `m${minute}`): DiscussionEntry => ({
  at: at(minute),
  comment: { createdAt: at(minute).toISOString(), deletedAt: null, id } as AcceptanceCommentItem,
  kind: 'message',
});
const round = (minute: number, roundIndex: number): DiscussionEntry => ({
  at: at(minute),
  kind: 'round',
  roundIndex,
});

describe('groupDiscussionByRound', () => {
  it('cuts the stream at each landing, newest round first, pre-delivery last', () => {
    const sections = groupDiscussionByRound([
      message(1),
      round(2, 1),
      message(3),
      { at: at(4), comment: 'fix the heading', kind: 'roundReject', roundIndex: 1 },
      round(5, 2),
      message(6),
    ]);

    expect(sections.map((section) => section.roundIndex)).toEqual([2, 1, null]);
    expect(sections[0].entries.map((entry) => entry.kind)).toEqual(['round', 'message']);
    expect(sections[1].entries.map((entry) => entry.kind)).toEqual([
      'round',
      'message',
      'roundReject',
    ]);
    expect(sections[2].entries).toHaveLength(1);
  });

  it('marks a round that was sent back and dates it from its landing', () => {
    const [latest, sentBack] = groupDiscussionByRound([
      round(2, 1),
      { at: at(4), kind: 'roundReject', roundIndex: 1 },
      round(5, 2),
    ]);

    expect(sentBack.sentBack).toBe(true);
    expect(sentBack.landedAt).toEqual(at(2));
    expect(latest.sentBack).toBe(false);
  });

  it('counts what people said, not the events between', () => {
    const [section] = groupDiscussionByRound([
      round(2, 1),
      message(3),
      message(4, 'gone'),
      { at: at(5), kind: 'roundReject', roundIndex: 1 },
    ]);

    expect(section.messageCount).toBe(2);
  });

  it('keeps a delivery with no rounds yet as one undated section', () => {
    const sections = groupDiscussionByRound([message(1), message(2)]);

    expect(sections).toHaveLength(1);
    expect(sections[0].roundIndex).toBeNull();
    expect(sections[0].landedAt).toBeUndefined();
  });

  it('returns nothing for an empty discussion', () => {
    expect(groupDiscussionByRound([])).toEqual([]);
  });
});
