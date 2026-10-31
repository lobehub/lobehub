import type { AcceptanceCommentItem, AcceptanceCommentThread } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { AcceptanceEvidence } from '../Checks/types';
import { historicalCommentEntries } from './historicalThreads';

const evidence = (
  id: string,
  type = 'video',
  fileUrl: string | null = 'https://example.com/video',
) => ({ fileUrl, id, type }) as AcceptanceEvidence;
const thread = (
  id: string,
  evidenceId: string,
  time: number | null = 2,
): AcceptanceCommentThread => ({
  replies: [],
  root: {
    evidenceId,
    id,
    rect: { height: 0.2, width: 0.2, x: 0.1, y: 0.1 },
    time: time === null ? null : { start: time },
  } as AcceptanceCommentItem,
});
const videos = new Map([
  ['video-a', evidence('video-a')],
  ['video-b', evidence('video-b')],
]);

describe('historicalCommentEntries', () => {
  it('mounts one evidence entry for many roots on the same video, including the same frame', () => {
    const threads = [
      thread('a', 'video-a', 2),
      thread('b', 'video-a', 6),
      thread('c', 'video-a', 6),
    ];
    expect(historicalCommentEntries(threads, videos)).toEqual([
      { evidence: videos.get('video-a'), type: 'video' },
    ]);
  });

  it('keeps different videos separate in first-occurrence order', () => {
    const threads = [thread('b', 'video-b'), thread('a', 'video-a'), thread('c', 'video-b')];
    expect(historicalCommentEntries(threads, videos).map((entry) => entry.evidence?.id)).toEqual([
      'video-b',
      'video-a',
    ]);
  });

  it('retains every image, unavailable evidence and incomplete anchor as a readable thread', () => {
    const items = new Map([
      ...videos,
      ['image', evidence('image', 'screenshot')],
      ['unavailable', evidence('unavailable', 'video', null)],
    ]);
    const threads = [
      thread('a', 'video-a'),
      thread('b', 'image', null),
      thread('c', 'image', null),
      thread('d', 'unavailable'),
      thread('e', 'missing'),
      thread('f', 'video-a', null),
    ];
    const entries = historicalCommentEntries(threads, items);
    expect(entries[0]).toEqual({ evidence: videos.get('video-a'), type: 'video' });
    expect(
      entries.slice(1).map((entry) => entry.type === 'thread' && entry.thread.root.id),
    ).toEqual(['b', 'c', 'd', 'e', 'f']);
  });
});
