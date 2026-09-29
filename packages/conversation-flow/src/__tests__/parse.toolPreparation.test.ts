import { describe, expect, it } from 'vitest';

import { parse } from '../parse';
import type { Message } from '../types/shared';

const originalArgs = { content: 'A', path: 'A.txt' };
const effectiveArgs = { content: 'B', path: 'B.txt' };

const turn = (index: number, parentId: string, args = effectiveArgs): Message[] => [
  {
    content: '',
    createdAt: index * 2,
    updatedAt: index * 2,
    id: `assistant-${index}`,
    parentId,
    role: 'assistant',
    tools: [
      {
        id: 'native',
        identifier: 'fs',
        apiName: 'write',
        type: 'builtin',
        arguments: JSON.stringify(originalArgs),
      },
    ],
  },
  {
    content: '',
    createdAt: index * 2 + 1,
    updatedAt: index * 2 + 1,
    id: `tool-${index}`,
    parentId: `assistant-${index}`,
    role: 'tool',
    tool_call_id: 'native',
    plugin: {
      identifier: 'fs',
      apiName: 'write',
      type: 'builtin',
      arguments: JSON.stringify(args),
    },
    pluginIntervention: { status: 'pending' },
    pluginState: { hookPreparation: { status: 'ready', originalArgs, effectiveArgs: args } },
  },
];
const user: Message = { id: 'user', role: 'user', content: 'write', createdAt: 0, updatedAt: 0 };
const projectedTools = (messages: Message[]) =>
  parse(messages).flatList.flatMap(
    (message) => message.children?.flatMap((child) => child.tools ?? []) ?? [],
  );

describe('prepared tool arguments in cold message projection', () => {
  it.each(['pending', 'approved'] as const)(
    'uses the durable %s tool input without mutating original history',
    (status) => {
      const messages = [user, ...turn(1, 'user')];
      messages[2].pluginIntervention = { status };
      const before = structuredClone(messages);
      // Fresh query/worker reconstruction, with no live runtime preparation cache.
      const tools = projectedTools(structuredClone(messages));
      expect(tools).toEqual([
        expect.objectContaining({
          id: 'native',
          arguments: JSON.stringify(effectiveArgs),
          result_msg_id: 'tool-1',
          intervention: { status },
        }),
      ]);
      expect(tools[0].result?.state).toMatchObject({ hookPreparation: { originalArgs } });
      expect(projectedTools(structuredClone(messages))).toEqual(tools);
      expect(messages).toEqual(before);
      expect(messages[1].tools?.[0].arguments).toBe(JSON.stringify(originalArgs));
    },
  );

  it('keeps reused native IDs scoped to their own assistant turn', () => {
    const laterArgs = { content: 'C', path: 'C.txt' };
    const tools = projectedTools([user, ...turn(1, 'user'), ...turn(2, 'tool-1', laterArgs)]);
    expect(tools.map(({ arguments: args, result_msg_id }) => ({ args, result_msg_id }))).toEqual([
      { args: JSON.stringify(effectiveArgs), result_msg_id: 'tool-1' },
      { args: JSON.stringify(laterArgs), result_msg_id: 'tool-2' },
    ]);
  });

  it('preserves legacy and streaming inputs without a persisted preparation', () => {
    const messages = [user, ...turn(1, 'user')];
    messages[2].pluginState = undefined;
    expect(projectedTools(messages)[0].arguments).toBe(JSON.stringify(originalArgs));
    expect(projectedTools(messages.slice(0, 2))[0].arguments).toBe(JSON.stringify(originalArgs));
  });

  it('uses the persisted input after a human edit, preserving the original hook snapshot', () => {
    const messages = [user, ...turn(1, 'user')];
    messages[2].plugin!.arguments = '{}';
    expect(projectedTools(messages)[0].arguments).toBe('{}');
    expect(projectedTools(messages)[0].result?.state).toMatchObject({
      hookPreparation: { originalArgs, effectiveArgs },
    });
  });
});
