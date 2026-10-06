import { describe, expect, it, vi } from 'vitest';

import type { PlanRuntimeService } from './index';
import { PlanExecutionRuntime } from './index';

/**
 * Todos have two stores with different lifetimes:
 *
 * - the topic's plan document — a mirror that only exists once `createPlan` ran;
 * - the tool message's `pluginState.todos` — always written, and the thing the
 *   prompt side reads back via `extractTodosFromMessages`.
 *
 * The server tool-execution path used to pass neither, so it read the plan
 * document only. An agent that called `createTodos` without `createPlan` had no
 * document, so every later `updateTodos` reloaded an empty list, dropped its
 * index-based operations out of bounds, and answered "No operations applied." —
 * then wrote that empty list back into `pluginState`, wiping the message-history
 * copy as well.
 */
const createService = (planTodos?: { status: string; text: string }[]) =>
  ({
    createPlan: vi.fn(),
    findPlanById: vi.fn(),
    findPlanByTopic: vi.fn().mockResolvedValue(
      planTodos
        ? {
            content: null,
            createdAt: new Date(0),
            description: null,
            id: 'doc_1',
            metadata: { todos: { items: planTodos, updatedAt: '2026-01-01T00:00:00.000Z' } },
            title: null,
            updatedAt: new Date(0),
          }
        : null,
    ),
    updatePlan: vi.fn(),
    updatePlanMetadata: vi.fn(),
  }) as unknown as PlanRuntimeService;

describe('PlanExecutionRuntime todo resolution', () => {
  it('applies operations against currentTodos when the topic has no plan document', async () => {
    const runtime = new PlanExecutionRuntime(createService());

    const updated = await runtime.updateTodos(
      { operations: [{ index: 0, type: 'complete' }] },
      {
        currentTodos: [
          { status: 'todo', text: 'env setup' },
          { status: 'todo', text: 'run case 1' },
          { status: 'todo', text: 'write report' },
        ],
        messageId: 'msg_1',
        topicId: 'tpc_1',
      },
    );

    expect(updated.content).not.toContain('No operations applied.');
    expect((updated.state as any).todos.items).toHaveLength(3);
    expect((updated.state as any).todos.items[0].status).toBe('completed');
  });

  it('falls back to the plan document only when currentTodos is undefined', async () => {
    const runtime = new PlanExecutionRuntime(
      createService([
        { status: 'todo', text: 'restored from plan' },
        { status: 'todo', text: 'second item' },
      ]),
    );

    const updated = await runtime.updateTodos(
      { operations: [{ index: 1, type: 'complete' }] },
      { messageId: 'msg_1', topicId: 'tpc_1' },
    );

    expect(updated.content).not.toContain('No operations applied.');
    expect((updated.state as any).todos.items).toHaveLength(2);
    expect((updated.state as any).todos.items[1].status).toBe('completed');
  });

  it('keeps an explicitly cleared list cleared even if the plan mirror is stale', async () => {
    // `syncTodosToPlan` swallows its errors, so the plan document can still hold
    // the items `clearTodos` just removed. An empty `currentTodos` is the agent's
    // real answer — treating it as "unknown" resurrects those items.
    const runtime = new PlanExecutionRuntime(
      createService([
        { status: 'todo', text: 'stale item from the mirror' },
        { status: 'todo', text: 'another stale item' },
      ]),
    );

    const created = await runtime.createTodos(
      { adds: ['a fresh item'] },
      { currentTodos: [], messageId: 'msg_1', topicId: 'tpc_1' },
    );

    expect((created.state as any).todos.items).toEqual([{ status: 'todo', text: 'a fresh item' }]);
  });

  it('still reports the full list in state so pluginState never regresses to empty', async () => {
    const runtime = new PlanExecutionRuntime(createService());

    const created = await runtime.createTodos(
      { adds: ['env setup', 'run case 1'] },
      { messageId: 'msg_1', topicId: 'tpc_1' },
    );

    expect((created.state as any).todos.items).toHaveLength(2);
  });
});
