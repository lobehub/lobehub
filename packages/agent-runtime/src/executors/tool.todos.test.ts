import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentRuntimeHost, ToolRunContext } from '../transport';
import type { AgentInstruction, AgentState } from '../types';
import { callToolsBatch } from './tool';
import { createState, createToolExecutorFixture } from './tool.testUtils';

type TodoItem = { status: 'completed' | 'processing' | 'todo'; text: string };

/**
 * Production (2026-11-05): a model batching `clearTodos(all)` + `createTodos`
 * got the cleared items back, and `createTodos` + `updateTodos(index: 0)` edited
 * an item from the previous list. Every call in a batch rebuilt its todos from
 * the pre-batch message snapshot and ran concurrently, so no call saw a
 * sibling's write. The model chased the inconsistent lists for ~490 calls.
 */
describe('todo calls within one batch', () => {
  let runTool: Mock;
  let host: AgentRuntimeHost;

  const oldItems: TodoItem[] = [
    { status: 'completed', text: 'old 1' },
    { status: 'completed', text: 'old 2' },
  ];

  const stateWithOldTodos = (): AgentState =>
    createState({
      messages: [
        { content: 'clean up dev junk', id: 'user-1', role: 'user' },
        {
          content: 'todo tool result',
          id: 'tool-msg-0',
          plugin: { apiName: 'createTodos', identifier: 'lobe-agent', type: 'builtin' },
          pluginState: { todos: { items: oldItems, updatedAt: '2026-11-05T23:15:00.000Z' } },
          role: 'tool',
        },
      ] as unknown as AgentState['messages'],
    });

  const todoCall = (id: string, apiName: string, args: Record<string, unknown>) => ({
    apiName,
    arguments: JSON.stringify(args),
    id,
    identifier: 'lobe-agent',
    type: 'builtin' as const,
  });

  const runBatch = (toolsCalling: ReturnType<typeof todoCall>[], state = stateWithOldTodos()) =>
    callToolsBatch(host)(
      {
        payload: { parentMessageId: 'assistant-msg-1', toolsCalling },
        type: 'call_tools_batch',
      } as Extract<AgentInstruction, { type: 'call_tools_batch' }>,
      state,
    );

  /** A minimal todo runtime: each call derives its list from `currentTodos`. */
  const seen: {
    apiName: string;
    stepTodos?: TodoItem[];
    streak?: number;
    todos?: TodoItem[];
  }[] = [];

  beforeEach(() => {
    ({ runTool, host } = createToolExecutorFixture());
    seen.length = 0;

    runTool.mockImplementation(
      async (tool: { apiName: string; arguments: string }, ctx: ToolRunContext) => {
        const args = JSON.parse(tool.arguments);
        const current = (ctx.currentTodos ?? []) as TodoItem[];
        seen.push({
          apiName: tool.apiName,
          stepTodos: ctx.stepContext?.todos?.items as TodoItem[] | undefined,
          streak: ctx.todoCallStreak,
          todos: current,
        });

        // The first call is the slowest: concurrent execution would let the
        // later ones run against the stale snapshot before it settles.
        if (seen.length === 1) await new Promise((resolve) => setTimeout(resolve, 20));

        if (!tool.apiName.endsWith('Todos')) {
          return { attempts: 1, result: { content: 'ok', state: {}, success: true } };
        }

        let items: TodoItem[];
        if (tool.apiName === 'clearTodos') items = [];
        else if (tool.apiName === 'createTodos')
          items = [...current, ...args.adds.map((text: string) => ({ status: 'todo', text }))];
        else
          items = current.map((item, index) =>
            index === args.operations[0].index ? { ...item, status: 'completed' } : item,
          );

        return {
          attempts: 1,
          result: {
            content: 'ok',
            state: { todos: { items, updatedAt: '2026-11-05T23:16:00.000Z' } },
            success: true,
          },
        };
      },
    );
  });

  it('feeds each todo call the list its predecessor produced, in emission order', async () => {
    await runBatch([
      todoCall('call-clear', 'clearTodos', { mode: 'all' }),
      todoCall('call-create', 'createTodos', { adds: ['new 1', 'new 2'] }),
      todoCall('call-update', 'updateTodos', { operations: [{ index: 0, type: 'complete' }] }),
    ]);

    expect(seen.map(({ apiName, todos }) => ({ apiName, todos }))).toEqual([
      { apiName: 'clearTodos', todos: oldItems },
      { apiName: 'createTodos', todos: [] },
      {
        apiName: 'updateTodos',
        todos: [
          { status: 'todo', text: 'new 1' },
          { status: 'todo', text: 'new 2' },
        ],
      },
    ]);
  });

  it('mirrors the threaded list into stepContext.todos for the client executor', async () => {
    // The client transport hands `stepContext` (not `currentTodos`) to the
    // lobe-agent client executor, so the threaded list must reach it there too.
    await runBatch([
      todoCall('call-clear', 'clearTodos', { mode: 'all' }),
      todoCall('call-create', 'createTodos', { adds: ['new 1'] }),
      todoCall('call-update', 'updateTodos', { operations: [{ index: 0, type: 'complete' }] }),
    ]);

    expect(seen.map(({ stepTodos }) => stepTodos)).toEqual([
      undefined,
      [],
      [{ status: 'todo', text: 'new 1' }],
    ]);
  });

  it('counts todo calls earlier in the batch into the streak', async () => {
    const calls = [
      todoCall('call-1', 'updateTodos', { operations: [{ index: 0, type: 'complete' }] }),
      todoCall('call-2', 'updateTodos', { operations: [{ index: 1, type: 'complete' }] }),
      todoCall('call-3', 'clearTodos', { mode: 'completed' }),
    ];
    // As in production: the step's assistant is already persisted and folded
    // into a group that carries this batch's calls without results.
    const state = stateWithOldTodos();
    state.messages.push({
      children: [
        { tools: calls.map(({ apiName, id, identifier }) => ({ apiName, id, identifier })) },
      ],
      content: '',
      id: 'assistant-group-1',
      role: 'assistantGroup',
    } as unknown as AgentState['messages'][number]);

    await runBatch(calls, state);

    // One todo call already sits in history after the user message.
    expect(seen.map(({ streak }) => streak)).toEqual([1, 2, 3]);
  });

  it('resets the streak at a non-todo call emitted earlier in the batch', async () => {
    const readFile = {
      apiName: 'readFile',
      arguments: '{}',
      id: 'call-read',
      identifier: 'local-system',
      type: 'builtin' as const,
    };

    await runBatch([
      todoCall('call-1', 'updateTodos', { operations: [{ index: 0, type: 'complete' }] }),
      readFile as any,
      todoCall('call-2', 'updateTodos', { operations: [{ index: 1, type: 'complete' }] }),
    ]);

    const streaks = Object.fromEntries(
      seen.filter((call) => call.apiName === 'updateTodos').map((call, i) => [i, call.streak]),
    );
    // call-1 follows the todo call in history; call-2 follows real work.
    expect(streaks).toEqual({ 0: 1, 1: 0 });
  });

  it('keeps the previous list when a todo call returns no todos state', async () => {
    runTool.mockImplementationOnce(async (tool: { apiName: string }, ctx: ToolRunContext) => {
      seen.push({
        apiName: tool.apiName,
        streak: ctx.todoCallStreak,
        todos: ctx.currentTodos as any,
      });
      return { attempts: 1, result: { content: 'paused', success: false } };
    });

    await runBatch([
      todoCall('call-1', 'clearTodos', { mode: 'all' }),
      todoCall('call-2', 'createTodos', { adds: ['new'] }),
    ]);

    expect(seen[1].todos).toEqual(oldItems);
  });
});
