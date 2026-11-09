// @vitest-environment node
import type { MeetingActionItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { mergeActionItems, SAME_PASSAGE_MS } from '../mergeActionItems';

const item = (patch: Partial<MeetingActionItem> & { id: string }): MeetingActionItem => ({
  segmentIds: [`seg_${patch.id}`],
  startMs: 0,
  status: 'created',
  text: `task ${patch.id}`,
  ...patch,
});

const suggested = (patch: Partial<MeetingActionItem> & { id: string }): MeetingActionItem =>
  item({ status: 'suggested', ...patch });

describe('mergeActionItems', () => {
  it('keeps created items and drops a suggestion citing the same segment', () => {
    const stored = [item({ id: 'a', segmentIds: ['seg_1'], startMs: 1000 })];
    const generated = [suggested({ id: 'new', segmentIds: ['seg_1'], startMs: 1000 })];

    expect(mergeActionItems(stored, generated)).toEqual({ fresh: [], items: stored });
  });

  it('drops a suggestion that cited a replaced segment but starts in the same passage', () => {
    // A refine pass rewrites the transcript: the kept item still points at the old segment
    // ids, the regenerated suggestion points at new ones for the same utterance.
    const stored = [item({ id: 'a', segmentIds: ['old_seg'], startMs: 61_000 })];
    const generated = [suggested({ id: 'new', segmentIds: ['new_seg'], startMs: 62_100 })];

    expect(mergeActionItems(stored, generated).fresh).toEqual([]);
  });

  it('keeps a suggestion from a different passage', () => {
    const stored = [item({ id: 'a', segmentIds: ['old_seg'], startMs: 61_000 })];
    const generated = [
      suggested({ id: 'new', segmentIds: ['new_seg'], startMs: 61_000 + SAME_PASSAGE_MS + 1 }),
    ];

    expect(mergeActionItems(stored, generated).fresh).toEqual(generated);
  });

  it('keeps suggestions without an offset unless a segment matches', () => {
    const stored = [item({ id: 'a', segmentIds: ['old_seg'], startMs: 61_000 })];
    const generated = [
      suggested({ id: 'no_offset', segmentIds: ['new_seg'], startMs: undefined }),
      suggested({ id: 'same_segment', segmentIds: ['old_seg'], startMs: 61_000 }),
    ];

    expect(mergeActionItems(stored, generated).fresh).toEqual([generated[0]]);
  });

  it('only treats created items as already turned into tasks', () => {
    const stored = [
      item({ id: 'dismissed', segmentIds: ['seg_1'], startMs: 1000, status: 'dismissed' }),
    ];
    const generated = [suggested({ id: 'new', segmentIds: ['seg_1'], startMs: 1000 })];

    expect(mergeActionItems(stored, generated)).toEqual({ fresh: generated, items: generated });
  });

  it('writes the surviving items before the new suggestions', () => {
    const stored = [
      item({ id: 'a', segmentIds: ['seg_1'], startMs: 1000 }),
      item({ id: 'b', segmentIds: ['seg_2'], startMs: 5000, status: 'suggested' }),
    ];
    const generated = [suggested({ id: 'new', segmentIds: ['seg_9'], startMs: 9000 })];

    expect(mergeActionItems(stored, generated).items.map((i) => i.id)).toEqual(['a', 'new']);
  });
});
