import { describe, expect, it } from 'vitest';

import { hasReviewRecord, latestThumbnail, walkNeighbors, walkOrder } from './flowStoryboard';

const node = (id: string, type: string, title = id) => ({ data: { title }, id, type });

describe('walkOrder', () => {
  it('numbers only the states, in the order the canvas lays them out', () => {
    expect(
      walkOrder([
        node('g', 'flowGroup'),
        node('a', 'state', 'Sidebar'),
        node('b', 'state', 'Usage'),
      ]),
    ).toEqual([
      { id: 'a', title: 'Sidebar' },
      { id: 'b', title: 'Usage' },
    ]);
  });
});

describe('walkNeighbors', () => {
  const order = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C' },
  ];

  it('offers the first state when nothing is selected yet', () => {
    expect(walkNeighbors(order, undefined)).toEqual({
      next: order[0],
      position: 0,
      previous: undefined,
    });
  });

  it('steps both ways from the middle and stops at the ends', () => {
    expect(walkNeighbors(order, 'b')).toEqual({ next: order[2], position: 2, previous: order[0] });
    expect(walkNeighbors(order, 'c')).toEqual({ next: undefined, position: 3, previous: order[1] });
  });
});

describe('latestThumbnail', () => {
  const shot = (fileUrl: string | null, type = 'screenshot') => ({ fileUrl, type });

  it('takes the first screenshot of the newest visit that has one', () => {
    expect(
      latestThumbnail([
        { evidence: [shot('old.png')] },
        { evidence: [shot(null), shot('clip.mp4', 'video'), shot('new.png')] },
      ]),
    ).toBe('new.png');
  });

  it('falls back to an earlier visit when the newest left no picture', () => {
    expect(latestThumbnail([{ evidence: [shot('old.png')] }, { evidence: [] }])).toBe('old.png');
  });

  it('has nothing to show for a state never captured', () => {
    expect(latestThumbnail([])).toBeUndefined();
  });
});

describe('hasReviewRecord', () => {
  it('counts a rejection that carries only circled regions or only an attachment', () => {
    expect(hasReviewRecord({})).toBe(false);
    expect(hasReviewRecord({ reviewComment: 'Range resets' })).toBe(true);
    expect(hasReviewRecord({ reviewDetail: { annotations: [{}] } })).toBe(true);
    expect(hasReviewRecord({ reviewAttachments: [{}] })).toBe(true);
    expect(hasReviewRecord({ reviewAttachments: [], reviewDetail: { annotations: [] } })).toBe(
      false,
    );
  });
});
