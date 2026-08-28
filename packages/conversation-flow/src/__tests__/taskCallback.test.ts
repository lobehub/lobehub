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

  it('surfaces a historical callback that lost the active branch race to a tool result', () => {
    const messages = [
      {
        content: '',
        createdAt: 1,
        id: 'a1',
        role: 'assistant',
        tools: [{ apiName: 'createTasks', id: 'call-1', identifier: 'lobe-task', type: 'builtin' }],
        updatedAt: 1,
      },
      {
        content: '## task completed',
        createdAt: 2,
        id: 'cb1',
        metadata: callbackMeta,
        parentId: 'a1',
        role: 'taskCallback',
        updatedAt: 2,
      },
      {
        content: 'Started task',
        createdAt: 3,
        id: 'tool1',
        parentId: 'a1',
        role: 'tool',
        tool_call_id: 'call-1',
        updatedAt: 3,
      },
      {
        content: 'I will wait for it.',
        createdAt: 4,
        id: 'a2',
        parentId: 'tool1',
        role: 'assistant',
        updatedAt: 4,
      },
    ] as unknown as Message[];

    const result = parse(messages);

    expect(result.flatList.map((message) => message.id)).toContain('cb1');
  });

  it('recovers all five callback/tool forks observed in tpc_3d1xrMayXKgr', () => {
    // Minimal reconstruction of the five production forks recorded in the
    // tpc_VDwcmaHa889c diagnosis. Four callbacks arrived before their sibling
    // tool result; the final callback arrived after it.
    const forks = [
      {
        callbackAt: '2026-07-26T14:28:21.121494Z',
        callbackId: 'task-cb-task_vXPxOsdo8kh2-tpc_gEbmBIxxJWi7',
        parentId: 'msg_2TIuqKJ80pNWoAMntg',
        toolAt: '2026-07-26T14:28:21.907155Z',
        toolId: 'msg_yVceaOEGPrwAs7MhHL',
      },
      {
        callbackAt: '2026-07-26T14:30:45.153031Z',
        callbackId: 'task-cb-task_R05cJyUJ4jZR-tpc_CbBHlcROmoh9',
        parentId: 'msg_4GKeA5laiBJHqhW1nH',
        toolAt: '2026-07-26T14:30:55.573965Z',
        toolId: 'msg_DxDMVks6A8m6ikkPbu',
      },
      {
        callbackAt: '2026-07-26T14:33:47.251124Z',
        callbackId: 'task-cb-task_JCXs4oqUs8If-tpc_o2KxCzGsuPRX',
        parentId: 'msg_DzS8S4yNhfmDs2Yzx4',
        toolAt: '2026-07-26T14:34:10.561836Z',
        toolId: 'msg_x74KlUhS6zzzWV5knY',
      },
      {
        callbackAt: '2026-07-26T14:29:54.438458Z',
        callbackId: 'task-cb-task_Ydo3xJ6rV51k-tpc_Q6hqQyt4DPhp',
        parentId: 'msg_VAYHAoBKHnDN9r6rlY',
        toolAt: '2026-07-26T14:30:07.144843Z',
        toolId: 'msg_q8Fb5Mmt3SWZiVMBXq',
      },
      {
        callbackAt: '2026-07-26T14:33:45.877828Z',
        callbackId: 'task-cb-task_F7rB3xJ3dygO-tpc_lOotfzCHdayS',
        parentId: 'msg_yTQs1pQTNjvvDDZlSL',
        toolAt: '2026-07-26T14:33:44.387709Z',
        toolId: 'msg_5s1B3wzX6yhipH9nYT',
      },
    ];
    const messages = forks.flatMap((fork, index) => {
      const toolCallId = `call-${index}`;
      const parentAt = new Date(
        Math.min(new Date(fork.callbackAt).getTime(), new Date(fork.toolAt).getTime()) - 1000,
      ).toISOString();

      return [
        {
          content: '',
          createdAt: parentAt,
          id: fork.parentId,
          role: 'assistant',
          tools: [
            { apiName: 'queryTask', id: toolCallId, identifier: 'lobe-task', type: 'builtin' },
          ],
          updatedAt: parentAt,
        },
        {
          content: `Task callback ${index + 1}`,
          createdAt: fork.callbackAt,
          id: fork.callbackId,
          metadata: {
            taskCallback: {
              identifier: `T-${72 + index}`,
              reason: 'done',
              taskId: `task-${index}`,
            },
          },
          parentId: fork.parentId,
          role: 'taskCallback',
          updatedAt: fork.callbackAt,
        },
        {
          content: `Inactive callback continuation ${index + 1}`,
          createdAt: new Date(new Date(fork.callbackAt).getTime() + 50).toISOString(),
          id: `callback-assistant-${index}`,
          parentId: fork.callbackId,
          role: 'assistant',
          updatedAt: new Date(new Date(fork.callbackAt).getTime() + 50).toISOString(),
        },
        {
          content: `Tool result ${index + 1}`,
          createdAt: fork.toolAt,
          id: fork.toolId,
          parentId: fork.parentId,
          role: 'tool',
          tool_call_id: toolCallId,
          updatedAt: fork.toolAt,
        },
        {
          content: `Active tool continuation ${index + 1}`,
          createdAt: new Date(new Date(fork.toolAt).getTime() + 50).toISOString(),
          id: `tool-assistant-${index}`,
          parentId: fork.toolId,
          role: 'assistant',
          updatedAt: new Date(new Date(fork.toolAt).getTime() + 50).toISOString(),
        },
      ];
    }) as unknown as Message[];

    const result = parse(messages);
    const visibleIds = result.flatList.map((message) => message.id);

    expect(forks.every(({ callbackId }) => visibleIds.includes(callbackId))).toBe(true);
    expect(visibleIds.some((id) => id.startsWith('callback-assistant-'))).toBe(false);
  });
});
