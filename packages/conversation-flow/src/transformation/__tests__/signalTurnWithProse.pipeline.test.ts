import { describe, expect, it } from 'vitest';

import type { Message } from '../../types';
import { BranchResolver } from '../BranchResolver';
import { FlatListBuilder } from '../FlatListBuilder';
import { MessageCollector } from '../MessageCollector';
import { MessageTransformer } from '../MessageTransformer';

/**
 * Read-side half of the tpc_MAA6wBdUN1gw "消息链又断了" fix.
 *
 * When the agent parks on a long-running background tool, the stdout push that
 * wakes it is exactly how its real reply arrives: a toolless turn tagged
 * `signal` at stream_start, carrying the whole answer. Treated as a reactive
 * callback it was folded into the collapsed SignalCallbacks accordion while the
 * throwaway acks around it rendered inline — the run looked like it trailed off.
 *
 * `signal` is trigger provenance, not structure. The WRITER settles whether a
 * woken turn was a callback or an answer and persists the verdict as
 * `metadata.signalPromoted`, AND advances the spine onto a promoted turn so the
 * next turn is persisted LINEARLY under it. The read side here just reads the
 * marker — it never re-derives the verdict from content, and because a promoted
 * turn is linear it never competes with the real continuation as a fork.
 */

const toolArr = (id: string) => [
  { apiName: 'Bash', arguments: '{}', id, identifier: 'claude-code', type: 'default' as const },
];

const signal = (seq: number, promoted = false) =>
  ({
    signal: {
      sequence: seq,
      sourceToolCallId: 'bashwait',
      sourceToolName: 'Bash',
      type: 'tool-stdout',
    },
    ...(promoted && { signalPromoted: true }),
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

describe('signal turn that delivers an answer — read-side main-chain (tpc_MAA6wBdUN1gw)', () => {
  // Post-fix persisted shape. The writer promoted PLAN (so it carries
  // `signalPromoted` AND the spine advanced onto it), hence NEXT is persisted
  // LINEARLY under PLAN — not forked off W.
  //   u1 → W(tool) → toolW ─ PLAN(signal+promoted) → NEXT(final answer)
  const linear: Message[] = [
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
      content: 'PLANMARKER 探查回来了，方案可以落到文件级',
      createdAt: 120,
      id: 'PLAN',
      metadata: signal(1, true),
      parentId: 'toolW',
      role: 'assistant',
      updatedAt: 120,
    },
    {
      agentId: 'a',
      content: 'TAILMARKER 开做，先切分支',
      createdAt: 130,
      id: 'NEXT',
      parentId: 'PLAN',
      role: 'assistant',
      updatedAt: 130,
    },
  ];

  it('renders a promoted answer on the main chain and keeps the following turn', () => {
    const flat = flatten(linear);
    const json = JSON.stringify(flat);

    // The answer renders as a chain step, not folded into the accordion …
    expect(json).toContain('PLANMARKER');
    expect(callbackIds(groupOf(flat))).not.toContain('PLAN');
    // … and the turn AFTER it is not dropped (the Codex P1 regression).
    expect(json).toContain('TAILMARKER');
  });

  it('keeps a toolless, UNPROMOTED signal note as a callback', () => {
    // No `signalPromoted` → a one-line reactive note, stays in the accordion.
    const flat = flatten([
      ...linear.slice(0, 3),
      {
        agentId: 'a',
        content: '（计时器到点了，没有新信息。）',
        createdAt: 120,
        id: 'NOTE',
        metadata: signal(1),
        parentId: 'toolW',
        role: 'assistant',
        updatedAt: 120,
      } as Message,
    ]);

    expect(callbackIds(groupOf(flat))).toEqual(['NOTE']);
  });

  it('does not drop the continuation for a legacy UNPROMOTED answer (no regression)', () => {
    // An old row written before the fix: a long toolless signal turn with NO
    // marker, and — because the writer never promoted it — NEXT forked off W.
    // Without the marker the reader keeps classifying it as a callback, so the
    // chain still follows NEXT. The answer stays in the accordion (unchanged
    // from today), but nothing is dropped.
    const legacy: Message[] = [
      ...linear.slice(0, 3),
      {
        agentId: 'a',
        content: 'PLANMARKER 探查回来了，方案可以落到文件级',
        createdAt: 120,
        id: 'PLAN',
        metadata: signal(1),
        parentId: 'toolW',
        role: 'assistant',
        updatedAt: 120,
      } as Message,
      {
        agentId: 'a',
        content: 'TAILMARKER 开做，先切分支',
        createdAt: 130,
        id: 'NEXT',
        parentId: 'W',
        role: 'assistant',
        updatedAt: 130,
      } as Message,
    ];
    const flat = flatten(legacy);
    const json = JSON.stringify(flat);

    expect(json).toContain('TAILMARKER');
    expect(callbackIds(groupOf(flat))).toContain('PLAN');
  });
});
