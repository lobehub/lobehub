import type { ArtboardCommentThreadView } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { pinTone, popoverBox, threadNumbers } from './layout';

const thread = (id: string, patch: Partial<ArtboardCommentThreadView> = {}) =>
  ({
    anchor: null,
    authorAgentId: null,
    authorUserId: 'u1',
    boardId: null,
    content: id,
    createdAt: new Date(0),
    groupId: null,
    id,
    pageId: 'p1',
    replies: [],
    resolvedAt: null,
    stale: false,
    unread: false,
    ...patch,
  }) as ArtboardCommentThreadView;

describe('popoverBox', () => {
  const size = { height: 800, width: 1200 };

  it('opens 42px right of the pin, top aligned with the pin head', () => {
    expect(popoverBox({ x: 200, y: 300 }, size, 200)).toEqual({
      left: 242,
      maxHeight: 420,
      top: 272,
      width: 300,
    });
  });

  it('flips to the left of the pin when the right side overflows', () => {
    expect(popoverBox({ x: 1000, y: 300 }, size, 200).left).toBe(1000 - 14 - 300);
  });

  it('keeps 12px from the edges and 64px from the top', () => {
    expect(popoverBox({ x: 0, y: 10 }, size, 200)).toMatchObject({ left: 42, top: 64 });
    expect(popoverBox({ x: 200, y: 790 }, size, 300).top).toBe(800 - 300 - 12);
    expect(popoverBox({ x: 200, y: 790 }, size, 900).top).toBe(800 - 420 - 12);
  });

  it('narrows to the viewport minus 24px', () => {
    expect(popoverBox({ x: 10, y: 300 }, { height: 600, width: 280 }, 100)).toMatchObject({
      left: 12,
      width: 256,
    });
  });

  it('caps the height to what fits under the top inset', () => {
    expect(popoverBox({ x: 10, y: 100 }, { height: 300, width: 900 }, 500).maxHeight).toBe(
      300 - 64 - 12,
    );
  });
});

describe('threadNumbers', () => {
  it('numbers threads by creation order across the artboard', () => {
    const numbers = threadNumbers([
      thread('b', { createdAt: new Date(2000) }),
      thread('a', { createdAt: new Date(1000) }),
      thread('c', { createdAt: new Date(2000), pageId: 'p2' }),
    ]);
    expect([...numbers]).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
  });

  it('accepts serialized dates', () => {
    const numbers = threadNumbers([
      thread('late', { createdAt: '2026-01-02T00:00:00Z' as unknown as Date }),
      thread('early', { createdAt: '2026-01-01T00:00:00Z' as unknown as Date }),
    ]);
    expect(numbers.get('early')).toBe(1);
  });
});

describe('pinTone', () => {
  const agent = { authorAgentId: 'agt', authorUserId: null };
  const answer = {
    authorAgentId: null,
    authorUserId: 'u1',
    content: 'ok',
    createdAt: new Date(0),
    id: 'r',
  };

  it('marks a question the user still owes an answer as waiting', () => {
    expect(pinTone(thread('q', agent))).toBe('waiting');
    expect(pinTone(thread('q', { ...agent, replies: [answer] }))).toBe('default');
  });

  it('puts resolved before stale before waiting', () => {
    expect(pinTone(thread('t', { resolvedAt: new Date(1), stale: true }))).toBe('resolved');
    expect(pinTone(thread('t', { ...agent, stale: true }))).toBe('stale');
    expect(pinTone(thread('t'))).toBe('default');
  });
});
