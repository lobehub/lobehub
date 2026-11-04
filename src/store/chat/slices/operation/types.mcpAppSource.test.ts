import { describe, expect, it } from 'vitest';

import { mergeQueuedMessages } from '@/store/chat/slices/operation/types';

const queued = (id: string, createdAt: number, identifier?: string) => ({
  content: id,
  createdAt,
  id,
  interruptMode: 'soft' as const,
  ...(identifier ? { metadata: { mcpAppSource: { identifier } } } : {}),
});

describe('mergeQueuedMessages MCP App source', () => {
  it('names the view when every merged message came from it', () => {
    expect(
      mergeQueuedMessages([queued('q1', 1, 'weather'), queued('q2', 2, 'weather')]).metadata
        ?.mcpAppSource,
    ).toEqual({ identifier: 'weather' });
  });

  it('drops the view once a typed message or another view is merged in', () => {
    expect(
      mergeQueuedMessages([queued('q1', 1, 'weather'), queued('q2', 2)]).metadata?.mcpAppSource,
    ).toBeUndefined();
    expect(
      mergeQueuedMessages([queued('q1', 1, 'weather'), queued('q2', 2, 'maps')]).metadata
        ?.mcpAppSource,
    ).toBeUndefined();
  });
});
