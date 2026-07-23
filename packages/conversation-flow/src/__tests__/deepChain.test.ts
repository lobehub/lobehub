import { describe, expect, it } from 'vitest';

import { parse } from '../parse';
import type { Message } from '../types';

/**
 * Production topology: every user turn chains off the previous assistant
 * (publicApi.ts sets parentId = lastDisplayMessageId), so the message "tree" is
 * really a linked list whose depth equals the conversation length. Traversal
 * must not consume stack proportional to that depth.
 */
const linkedChain = (turns: number, opts: { tools?: boolean } = {}): Message[] => {
  const messages: Message[] = [];
  let previousAssistantId: string | undefined;

  for (let turn = 0; turn < turns; turn++) {
    const userId = `u-${turn}`;
    const assistantId = `a-${turn}`;

    messages.push({
      content: `question ${turn}`,
      createdAt: turn * 10,
      id: userId,
      parentId: previousAssistantId ?? null,
      role: 'user',
      updatedAt: turn * 10,
    } as Message);

    const assistant = {
      content: `answer ${turn}`,
      createdAt: turn * 10 + 1,
      id: assistantId,
      parentId: userId,
      role: 'assistant',
      updatedAt: turn * 10 + 1,
    } as Message;

    if (opts.tools && turn % 4 === 0) {
      const toolCallId = `call-${turn}`;
      const toolMessageId = `t-${turn}`;
      (assistant as any).tools = [
        {
          apiName: 'search',
          arguments: '{}',
          id: toolCallId,
          identifier: 'bench-plugin',
          result_msg_id: toolMessageId,
          type: 'default',
        },
      ];
      messages.push(assistant, {
        content: `tool result ${turn}`,
        createdAt: turn * 10 + 2,
        id: toolMessageId,
        parentId: assistantId,
        role: 'tool',
        tool_call_id: toolCallId,
        updatedAt: turn * 10 + 2,
      } as Message);
    } else {
      messages.push(assistant);
    }

    previousAssistantId = assistantId;
  }

  return messages;
};

/**
 * 3000 turns / 6000 rows sits well clear of every stack ceiling this engine has
 * had: the fully recursive walk died around 1.6k rows, and converting only
 * FlatListBuilder moved that to roughly 2.4k. Anything that reintroduces
 * depth-per-message in any of the three walks (structuring, contextTree,
 * flatList) fails here.
 */
const TURNS = 3000;

/**
 * A single unbroken agent run: every step calls a tool and the next step hangs
 * off that tool's result, so the whole thing collapses into ONE assistant group.
 * Chain collection walks step by step, so its cost must not be stack depth.
 */
const singleToolChain = (steps: number): Message[] => {
  const messages: Message[] = [
    {
      content: 'do the long thing',
      createdAt: 0,
      id: 'user-1',
      parentId: null,
      role: 'user',
      updatedAt: 0,
    } as unknown as Message,
  ];

  let parentId = 'user-1';
  for (let step = 0; step < steps; step++) {
    const assistantId = `ast-${step}`;
    const toolMessageId = `tool-${step}`;
    const toolCallId = `call-${step}`;

    messages.push({
      agentId: 'agent-1',
      content: `step ${step}`,
      createdAt: step * 2 + 1,
      id: assistantId,
      parentId,
      role: 'assistant',
      tools: [
        {
          apiName: 'run',
          arguments: '{}',
          id: toolCallId,
          identifier: 'shell',
          result_msg_id: toolMessageId,
          type: 'default',
        },
      ],
      updatedAt: step * 2 + 1,
    } as unknown as Message);

    messages.push({
      content: `result ${step}`,
      createdAt: step * 2 + 2,
      id: toolMessageId,
      parentId: assistantId,
      role: 'tool',
      tool_call_id: toolCallId,
      updatedAt: step * 2 + 2,
    } as Message);

    parentId = toolMessageId;
  }

  return messages;
};

/**
 * Every assistant carries two user replies, so each turn nests a branch inside
 * the previous branch's subtree — i.e. the user regenerated at every turn.
 *
 * This is the one walk still bounded by stack depth: a branch node's output is
 * itself nested (`branches: ContextNode[][]`), so `createBranchNode` re-enters
 * the linear walk per branch. It holds to roughly 800 levels and fails around
 * 1600; 500 here guards against that ceiling dropping.
 */
const nestedBranches = (levels: number): Message[] => {
  const messages: Message[] = [
    {
      content: 'q',
      createdAt: 0,
      id: 'u0',
      parentId: null,
      role: 'user',
      updatedAt: 0,
    } as unknown as Message,
  ];

  let parentId = 'u0';
  for (let level = 0; level < levels; level++) {
    messages.push({
      content: 'r',
      createdAt: level * 3 + 1,
      id: `a${level}`,
      metadata: { activeBranchIndex: 0 },
      parentId,
      role: 'assistant',
      updatedAt: level * 3 + 1,
    } as unknown as Message);
    messages.push({
      content: 'follow-up',
      createdAt: level * 3 + 2,
      id: `u${level}x`,
      parentId: `a${level}`,
      role: 'user',
      updatedAt: level * 3 + 2,
    } as Message);
    messages.push({
      content: 'regenerated follow-up',
      createdAt: level * 3 + 3,
      id: `u${level}y`,
      parentId: `a${level}`,
      role: 'user',
      updatedAt: level * 3 + 3,
    } as Message);
    parentId = `u${level}x`;
  }

  return messages;
};

describe('deep chain traversal', () => {
  it('should parse deeply nested branches', () => {
    expect(() => parse(nestedBranches(500))).not.toThrow();
  });

  it('should collect one very long assistant run without exhausting the stack', () => {
    const messages = singleToolChain(3000);

    expect(() => parse(messages)).not.toThrow();

    const result = parse(messages);
    // user row + one group bubble holding every step
    expect(result.flatList).toHaveLength(2);
    expect((result.flatList[1] as any).children).toHaveLength(3000);
  });

  it('should parse a deep linked chain without exhausting the stack', () => {
    const messages = linkedChain(TURNS);
    expect(messages).toHaveLength(TURNS * 2);

    expect(() => parse(messages)).not.toThrow();
    expect(parse(messages).flatList).toHaveLength(TURNS * 2);
  });

  it('should parse a deep tool-bearing chain without exhausting the stack', () => {
    const messages = linkedChain(TURNS, { tools: true });

    expect(() => parse(messages)).not.toThrow();
  });

  it('should keep chain order stable across the whole conversation', () => {
    const result = parse(linkedChain(TURNS));
    const ids = result.flatList.map((m) => m.id);

    expect(ids[0]).toBe('u-0');
    expect(ids[1]).toBe('a-0');
    expect(ids.at(-2)).toBe(`u-${TURNS - 1}`);
    expect(ids.at(-1)).toBe(`a-${TURNS - 1}`);
  });

  it('should build a contextTree for a deep chain', () => {
    const result = parse(linkedChain(TURNS));

    expect(result.contextTree).toHaveLength(TURNS * 2);
  });
});
