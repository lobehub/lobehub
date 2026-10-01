import { describe, expect, it } from 'vitest';

import { parse } from '../parse';
import type { Message } from '../types';

/**
 * A long topic is one parentId chain: every step hangs under the previous one.
 * Paging older history in makes these chains thousands of rows deep, so no
 * phase of `parse` may recurse once per message.
 */
const buildChain = (rounds: number, stepsPerRound: number, withTools = false): Message[] => {
  const messages: Message[] = [];
  let parentId: string | undefined;
  let t = 0;
  for (let r = 0; r < rounds; r += 1) {
    const userId = `u${r}`;
    messages.push({
      content: `q${r}`,
      createdAt: ++t,
      id: userId,
      meta: {},
      parentId,
      role: 'user',
      updatedAt: t,
    } as Message);
    parentId = userId;
    for (let s = 0; s < stepsPerRound; s += 1) {
      const id = `a${r}_${s}`;
      const toolCallId = `call_${r}_${s}`;
      messages.push({
        content: `a${r}.${s}`,
        createdAt: ++t,
        id,
        meta: {},
        parentId,
        role: 'assistant',
        tools: withTools
          ? [
              {
                apiName: 'run',
                arguments: '{}',
                id: toolCallId,
                identifier: 'demo',
                type: 'default',
              },
            ]
          : undefined,
        updatedAt: t,
      } as Message);
      parentId = id;
      if (withTools) {
        const toolId = `t${r}_${s}`;
        messages.push({
          content: 'ok',
          createdAt: ++t,
          id: toolId,
          meta: {},
          parentId: id,
          role: 'tool',
          tool_call_id: toolCallId,
          updatedAt: t,
        } as Message);
        parentId = toolId;
      }
    }
  }
  return messages;
};

// These assert stack depth. Chain collection looks steps up through per-parse
// indexes rather than rescanning the transcript, so they also stay fast.
describe('parse on deep message chains', () => {
  // The recursive walk overflowed Node's stack from ~2,000 plain / ~3,000
  // tool-call messages; browsers hit it near 1,200 inside a React render.
  it('parses a 4,000-message plain chain without overflowing the stack', () => {
    const messages = buildChain(200, 19);

    const result = parse(messages);

    expect(result.flatList.at(0)?.id).toBe('u0');
    expect(result.flatList.at(-1)?.id).toBe('a199_18');
    expect(result.flatList.filter((m) => m.role === 'user')).toHaveLength(200);
    expect(result.contextTree.filter((node) => node.id.startsWith('u'))).toHaveLength(200);
  });

  it('parses a 4,000-message tool-call chain without overflowing the stack', () => {
    const messages = buildChain(200, 10, true);

    const result = parse(messages);

    // Each round folds into one assistant group after its user message.
    expect(result.flatList.map((m) => m.role)).toEqual(
      Array.from({ length: 200 }, () => ['user', 'assistantGroup']).flat(),
    );
    expect(result.flatList.at(-1)?.children).toHaveLength(10);
  });
});
