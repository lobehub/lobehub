import { describe, expect, it, vi } from 'vitest';

import type { TodoItem } from '../types';
import type { PlanRuntimeService } from './index';
import { PlanExecutionRuntime } from './index';

/**
 * `updateTodos` used to `switch (op.type)` and silently skip any operation the
 * switch didn't match, then answer `success: true` + "No operations applied.".
 * In production glm-5.3-flash dropped the required `type` discriminator
 * (`{"index": 0, "status": "processing"}`), got a "success" that changed
 * nothing, and retried the identical call five times before giving up on the
 * tool entirely. The runtime now infers an unambiguous type, reports every
 * skipped operation with the reason, and fails loudly when nothing applied.
 */
const createRuntime = () =>
  new PlanExecutionRuntime({
    createPlan: vi.fn(),
    findPlanById: vi.fn(),
    findPlanByTopic: vi.fn().mockResolvedValue(null),
    updatePlan: vi.fn(),
    updatePlanMetadata: vi.fn(),
  } as unknown as PlanRuntimeService);

const currentTodos: TodoItem[] = [
  { status: 'todo', text: 'create linear issues' },
  { status: 'todo', text: 'cut worktree' },
];

const context = { currentTodos, messageId: 'msg_1', topicId: 'tpc_1' };

describe('updateTodos type inference', () => {
  it('applies an index+status operation that omits "type" as an update', async () => {
    const runtime = createRuntime();

    const result = await runtime.updateTodos(
      { operations: [{ index: 0, status: 'processing' }] },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).not.toContain('No operations applied.');
    expect((result.state as any).todos.items[0].status).toBe('processing');
  });

  it('applies a text-only operation that omits "type" as an add', async () => {
    const runtime = createRuntime();

    const result = await runtime.updateTodos({ operations: [{ text: 'open the PR' }] }, context);

    expect(result.success).toBe(true);
    expect((result.state as any).todos.items).toHaveLength(3);
    expect((result.state as any).todos.items[2]).toEqual({ status: 'todo', text: 'open the PR' });
  });

  it('does not guess between remove/complete for an index-only operation', async () => {
    const runtime = createRuntime();

    const result = await runtime.updateTodos({ operations: [{ index: 0 }] }, context);

    expect(result.success).toBe(false);
    expect(result.content).toContain('"type" is required');
    // Nothing changed, so no state is written — the previous pluginState.todos
    // stays the newest copy in message history.
    expect(result.state).toBeUndefined();
  });
});

describe('updateTodos invalid-operation reporting', () => {
  it('rejects an update that carries neither newText nor status', async () => {
    const runtime = createRuntime();

    const result = await runtime.updateTodos(
      { operations: [{ index: 0, type: 'update' }] },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain('No operations applied.');
    expect(result.content).toContain('provide "newText" and/or "status"');
    expect(result.state).toBeUndefined();
  });

  it('fails with the reason when every operation is invalid', async () => {
    const runtime = createRuntime();

    const result = await runtime.updateTodos(
      { operations: [{ index: 5, type: 'complete' }] },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain('No operations applied.');
    expect(result.content).toContain('"index" must be 0-1, got 5');
  });

  it('reports skipped operations alongside applied ones', async () => {
    const runtime = createRuntime();

    const result = await runtime.updateTodos(
      {
        operations: [
          { index: 0, type: 'complete' },
          { index: 9, type: 'remove' },
        ],
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain('Applied 1 operation');
    expect(result.content).toContain('Skipped 1 invalid operation');
    expect((result.state as any).todos.items[0].status).toBe('completed');
  });
});
