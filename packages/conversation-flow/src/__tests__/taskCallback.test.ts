import { describe, expect, it } from 'vitest';

import { parse } from '../parse';
import type { Message } from '../types/shared';

// A task-callback card injected by the result-bridge must survive
// the display-flow transform as a standalone `role='taskCallback'` node so the
// renderer can show it as a card — both as a leaf and mid-chain (when the
// creator agent's continuation parents under it).
describe('parse — taskCallback role', () => {
  const callbackMeta = {
    taskCallback: { identifier: 'T-1', reason: 'done' as const, taskId: 't1', topicId: 'tp1' },
  };

  it('keeps a leaf taskCallback message in the flatList with metadata intact', () => {
    const messages = [
      { content: 'dispatched', createdAt: 1, id: 'a1', role: 'assistant', updatedAt: 1 },
      {
        content: '## done\n\nsummary',
        createdAt: 2,
        id: 'cb1',
        metadata: callbackMeta,
        parentId: 'a1',
        role: 'taskCallback',
        updatedAt: 2,
      },
    ] as unknown as Message[];

    const result = parse(messages);
    const cb = result.flatList.find((m) => m.id === 'cb1');

    expect(cb).toBeDefined();
    expect(cb?.role).toBe('taskCallback');
    expect((cb?.metadata as any)?.taskCallback?.identifier).toBe('T-1');
  });

  it('keeps a taskCallback mid-chain when a continuation parents under it', () => {
    const messages = [
      { content: 'dispatched', createdAt: 1, id: 'a1', role: 'assistant', updatedAt: 1 },
      {
        content: '## done',
        createdAt: 2,
        id: 'cb1',
        metadata: callbackMeta,
        parentId: 'a1',
        role: 'taskCallback',
        updatedAt: 2,
      },
      {
        content: 'great, next?',
        createdAt: 3,
        id: 'a2',
        parentId: 'cb1',
        role: 'assistant',
        updatedAt: 3,
      },
    ] as unknown as Message[];

    const result = parse(messages);
    const ids = result.flatList.map((m) => m.id);

    // The card node must not be swallowed by the assistant chain around it.
    expect(ids).toContain('cb1');
    expect(result.flatList.find((m) => m.id === 'cb1')?.role).toBe('taskCallback');
    expect(ids).toContain('a2');
  });
});
