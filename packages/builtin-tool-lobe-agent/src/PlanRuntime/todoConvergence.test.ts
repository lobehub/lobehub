import { describe, expect, it, vi } from 'vitest';

import type { TodoItem } from '../types';
import type { PlanRuntimeContext, PlanRuntimeService } from './index';
import { PlanExecutionRuntime, TODO_CALL_STREAK_LIMIT } from './index';

/**
 * Production (2026-11-05, glm-5.3): one run made ~490 todo calls in 33 minutes.
 * Every call answered "success" with a list that looked settled, so the model
 * read each no-op as progress and kept going. Results that change nothing must
 * say so, and a long streak of todo-only calls must stop applying.
 */
const createRuntime = () =>
  new PlanExecutionRuntime({
    createPlan: vi.fn(),
    findPlanById: vi.fn(),
    findPlanByTopic: vi.fn().mockResolvedValue(null),
    updatePlan: vi.fn(),
    updatePlanMetadata: vi.fn(),
  } as unknown as PlanRuntimeService);

/** Feed each call the list the previous one returned, as message history does. */
const createSession = (runtime: PlanExecutionRuntime) => {
  let todos: TodoItem[] | undefined;
  let streak = 0;

  const context = (): PlanRuntimeContext => ({
    currentTodos: todos,
    messageId: 'msg_1',
    todoCallStreak: streak,
    topicId: 'tpc_1',
  });

  const track = async (call: Promise<any>) => {
    const result = await call;
    streak++;
    if (result.state?.todos) todos = result.state.todos.items;
    return result;
  };

  return {
    clear: (mode: 'all' | 'completed') => track(runtime.clearTodos({ mode }, context())),
    create: (adds: string[]) => track(runtime.createTodos({ adds }, context())),
    /** A non-todo tool call between todo calls resets the streak. */
    doWork: () => {
      streak = 0;
    },
    get todos() {
      return todos;
    },
    update: (operations: any[]) => track(runtime.updateTodos({ operations }, context())),
  };
};

describe('todo results that change nothing', () => {
  it('reports a repeated createTodos as a no-op instead of duplicating items', async () => {
    const session = createSession(createRuntime());

    await session.create(['survey dev junk', 'delete stale branches']);
    const repeated = await session.create(['survey dev junk', 'delete stale branches']);

    expect(repeated.success).toBe(true);
    expect(repeated.content).toContain('already in this state');
    expect(repeated.state.createdItems).toEqual([]);
    expect(session.todos).toEqual([
      { status: 'todo', text: 'survey dev junk' },
      { status: 'todo', text: 'delete stale branches' },
    ]);
  });

  it('adds only the new items when some are already open', async () => {
    const session = createSession(createRuntime());

    await session.create(['a']);
    const result = await session.create(['a', 'b']);

    expect(result.content).toContain('Added 1 item');
    expect(result.content).toContain('Skipped 1 item already on the list');
    expect(session.todos?.map((item) => item.text)).toEqual(['a', 'b']);
  });

  it('lets a completed item come back as a new round', async () => {
    const session = createSession(createRuntime());

    await session.create(['run tests']);
    await session.update([{ index: 0, type: 'complete' }]);
    const result = await session.create(['run tests']);

    expect(result.content).toContain('Added 1 item');
    expect(session.todos).toEqual([
      { status: 'completed', text: 'run tests' },
      { status: 'todo', text: 'run tests' },
    ]);
  });

  it('reports repeating the same status change as a no-op', async () => {
    const session = createSession(createRuntime());

    await session.create(['a']);
    const first = await session.update([{ index: 0, type: 'complete' }]);
    const repeated = await session.update([{ index: 0, type: 'complete' }]);

    expect(first.content).toContain('Applied 1 operation');
    expect(repeated.success).toBe(true);
    expect(repeated.content).toContain('No change');
    expect(repeated.content).toContain('already in this state');
    expect(session.todos).toEqual([{ status: 'completed', text: 'a' }]);
  });

  it('tells the model a repeated clearTodos had nothing to clear', async () => {
    const session = createSession(createRuntime());

    await session.create(['a']);
    await session.clear('all');
    const repeated = await session.clear('all');

    expect(repeated.content).toContain('already empty');
    expect(repeated.content).toContain('already in this state');
    expect(session.todos).toEqual([]);
  });

  it('converges on a create → update → list round trip without resurrecting old items', async () => {
    const session = createSession(createRuntime());

    await session.create(['old 1', 'old 2']);
    await session.clear('all');

    const updates = [];
    for (let round = 0; round < 3; round++) {
      await session.create(['new 1', 'new 2']);
      updates.push(await session.update([{ index: 0, type: 'processing' }]));
    }

    expect(session.todos).toEqual([
      { status: 'processing', text: 'new 1' },
      { status: 'todo', text: 'new 2' },
    ]);
    expect(updates.map((result) => result.content.split('\n')[0])).toEqual([
      '🔄 Applied 1 operation:',
      expect.stringContaining('No change'),
      expect.stringContaining('No change'),
    ]);
  });
});

describe('todo call streak limit', () => {
  it(`pauses todo mutations after ${TODO_CALL_STREAK_LIMIT} consecutive todo calls`, async () => {
    const session = createSession(createRuntime());

    await session.create(['a', 'b']);
    for (let i = 1; i < TODO_CALL_STREAK_LIMIT; i++) {
      await session.update([{ index: i % 2, status: i % 3 === 0 ? 'todo' : 'processing' }]);
    }
    const before = session.todos;

    const paused = await session.clear('all');

    expect(paused.success).toBe(false);
    expect(paused.error.type).toBe('TodoCallLoop');
    expect(paused.content).toContain('Todo tools paused');
    expect(paused.content).toContain('Nothing was changed');
    expect(paused.state).toBeUndefined();
    expect(session.todos).toBe(before);
  });

  it('keeps every API paused across a long loop until other work happens', async () => {
    const session = createSession(createRuntime());
    await session.create(['a']);

    const results = [];
    for (let i = 0; i < 30; i++) {
      results.push(
        await [
          () => session.update([{ index: 0, type: 'processing' }]),
          () => session.clear('all'),
          () => session.create([`item ${i}`]),
        ][i % 3](),
      );
    }

    const paused = results.filter((result) => result.error?.type === 'TodoCallLoop');
    expect(paused).toHaveLength(30 - (TODO_CALL_STREAK_LIMIT - 1));
    expect(results.slice(TODO_CALL_STREAK_LIMIT - 1).every((r) => !r.success)).toBe(true);

    session.doWork();
    const resumed = await session.update([{ index: 0, type: 'complete' }]);
    expect(resumed.success).toBe(true);
  });

  it('honors a configured streak limit', async () => {
    const runtime = new PlanExecutionRuntime(
      {
        createPlan: vi.fn(),
        findPlanById: vi.fn(),
        findPlanByTopic: vi.fn().mockResolvedValue(null),
        updatePlan: vi.fn(),
        updatePlanMetadata: vi.fn(),
      } as unknown as PlanRuntimeService,
      { todoCallStreakLimit: 3 },
    );

    const allowed = await runtime.createTodos(
      { adds: ['a'] },
      { currentTodos: [], todoCallStreak: 2 },
    );
    const paused = await runtime.createTodos(
      { adds: ['a'] },
      { currentTodos: [], todoCallStreak: 3 },
    );

    expect(allowed.success).toBe(true);
    expect(paused.error?.type).toBe('TodoCallLoop');
  });

  it('does not pause when the caller supplies no streak', async () => {
    const runtime = createRuntime();

    const result = await runtime.createTodos({ adds: ['a'] }, { currentTodos: [] });

    expect(result.success).toBe(true);
  });
});
