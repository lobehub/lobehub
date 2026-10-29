import { describe, expect, it } from 'vitest';

import type { Message } from '../../types';
import { BranchResolver } from '../BranchResolver';
import { FlatListBuilder } from '../FlatListBuilder';
import { MessageCollector } from '../MessageCollector';
import { MessageTransformer } from '../MessageTransformer';

/**
 * Read-side fix for tpc_MAA6wBdUN1gw "消息链又断了".
 *
 * When the agent parks on a long-running background tool, the stdout push that
 * wakes it is exactly how its real reply arrives: a toolless `tool-stdout` turn
 * carrying the whole answer. Folded into the collapsed SignalCallbacks accordion
 * (with the throwaway acks around it), the run looked like it trailed off.
 *
 * The fix is PURELY read-side and shape-preserving: an answer-length reactive
 * callback renders INLINE as a plain message in the group (like a
 * `task-completion`), while a one-line note stays in the accordion.
 * `getMessageSignal` is unchanged, so the turn is still a signal for the chain
 * walk — it never competes as a continuation, and the real next turn is never
 * dropped. The persisted parentId tree is untouched, so an older reader just
 * renders the answer in the accordion (graceful, nothing lost).
 */

const toolArr = (id: string) => [
  { apiName: 'Bash', arguments: '{}', id, identifier: 'claude-code', type: 'default' as const },
];

const stdout = (seq: number) =>
  ({
    signal: {
      sequence: seq,
      sourceToolCallId: 'bashwait',
      sourceToolName: 'Bash',
      type: 'tool-stdout',
    },
  }) as any;

const flatten = (messages: Message[]) => {
  const messageMap = new Map<string, Message>();
  const childrenMap = new Map<string | null, string[]>();
  messages.forEach((msg) => {
    messageMap.set(msg.id, msg);
    const parentId = msg.parentId || null;
    if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
    childrenMap.get(parentId)!.push(msg.id);
  });
  const builder = new FlatListBuilder(
    messageMap,
    new Map(),
    childrenMap,
    new BranchResolver(),
    new MessageCollector(messageMap, childrenMap),
    new MessageTransformer(),
  );
  return builder.flatten(messages);
};

const groupOf = (flat: Message[]) =>
  flat.find((m) => m.role === ('assistantGroup' as any)) as any | undefined;

const callbackIds = (group: any): string[] =>
  (group?.signalCallbacks ?? []).flatMap((b: any) => b.callbacks.map((c: any) => c.id));
const taskCompletionIds = (group: any): string[] =>
  (group?.taskCompletions ?? []).map((b: any) => b.id);

// The persisted shape the WRITER already produces (unchanged by this fix):
//   u1 → W(tool) → toolW ─┬─ PLAN (tool-stdout, long answer)
//                         └─ ACK  (tool-stdout, short note)
//   W → NEXT (the normal continuation — forked under W, as today)
const PLAN = 'PLANMARKER 探查回来了，方案可以落到文件级，完整判断如下：'.padEnd(220, '。');
const scenario: Message[] = [
  { content: 'go', createdAt: 0, id: 'u1', role: 'user', updatedAt: 0 },
  {
    agentId: 'a',
    content: '两个探查 agent 在跑',
    createdAt: 100,
    id: 'W',
    parentId: 'u1',
    role: 'assistant',
    tools: toolArr('bashwait'),
    updatedAt: 100,
  },
  {
    content: 'Command running in background',
    createdAt: 110,
    id: 'toolW',
    parentId: 'W',
    role: 'tool',
    tool_call_id: 'bashwait',
    updatedAt: 110,
  } as any,
  {
    agentId: 'a',
    content: PLAN,
    createdAt: 120,
    id: 'PLAN',
    metadata: stdout(1),
    parentId: 'toolW',
    role: 'assistant',
    updatedAt: 120,
  },
  {
    agentId: 'a',
    content: 'ACKMARKER （计时器到点了，没有新信息。）',
    createdAt: 130,
    id: 'ACK',
    metadata: stdout(2),
    parentId: 'toolW',
    role: 'assistant',
    updatedAt: 130,
  },
  {
    agentId: 'a',
    content: 'TAILMARKER 开做，先切分支',
    createdAt: 140,
    id: 'NEXT',
    parentId: 'W',
    role: 'assistant',
    updatedAt: 140,
  },
];

describe('answer-length reactive callback renders inline (tpc_MAA6wBdUN1gw)', () => {
  it('lifts the long answer out of the accordion and keeps the short note in it', () => {
    const flat = flatten(scenario);
    const group = groupOf(flat);

    expect(group).toBeDefined();
    // The long answer is an inline plain message, not an accordion callback.
    expect(taskCompletionIds(group)).toContain('PLAN');
    expect(callbackIds(group)).not.toContain('PLAN');
    // The one-line note stays in the accordion.
    expect(callbackIds(group)).toEqual(['ACK']);
  });

  it('never drops the real continuation', () => {
    const flat = flatten(scenario);
    // NEXT is a normal turn under W; the long answer stays a signal for the chain
    // walk, so it never competes as a continuation and NEXT survives.
    expect(JSON.stringify(flat)).toContain('TAILMARKER');
  });

  it('keeps a group whose only long callback leaves no empty accordion', () => {
    const flat = flatten(scenario.filter((m) => m.id !== 'ACK'));
    const group = groupOf(flat);
    expect(taskCompletionIds(group)).toContain('PLAN');
    expect(group.signalCallbacks ?? []).toHaveLength(0);
  });
});
