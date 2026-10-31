import { describe, expect, it } from 'vitest';

import { parse } from '../../parse';
import type { Message } from '../../types';
import { BranchResolver } from '../BranchResolver';
import { FlatListBuilder } from '../FlatListBuilder';
import { MessageCollector } from '../MessageCollector';
import { MessageTransformer } from '../MessageTransformer';

/**
 * Read-side half of the tpc_aGIggi9N8DpK "trace 和回复对不上 + 中间截断" fix.
 *
 * The write side (main-agent reducer) tags a turn `signal` at stream_start,
 * before it knows the turn will call tools. A reactive turn that CC re-invokes
 * off a long-running Bash `Wait for … agent` (`tool-stdout` / `task-completion`)
 * can then emit its OWN tool_use — at which point it is really back on the main
 * chain. `reduceMainAgent` now PROMOTES such a turn onto the spine so the next
 * normal turn chains off it (see reducer.test.ts "promotes a tools-bearing
 * signal turn onto the spine"). That produces the LINEAR shape below.
 *
 * These tests pin the read side's behavior on both shapes:
 *   - LINEAR (post-fix): the whole spine renders, tail included.
 *   - FORKED (pre-fix):  the signal turn and the tail both hang off the fork.
 *                        A wake-up is never a branch alternative, so the reader
 *                        renders both in creation order instead of dropping one.
 */

const toolArr = (id: string) => [
  { apiName: 'Bash', arguments: '{}', id, identifier: 'claude-code', type: 'default' as const },
];

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

/** Steps of the run's single AssistantGroup, in render order. */
const groupStepIds = (flat: Message[]): string[] => {
  const groups = flat.filter((m) => m.role === ('assistantGroup' as any)) as any[];
  expect(groups).toHaveLength(1);
  return groups[0].children.map((step: { id: string }) => step.id);
};

// The last fork of tpc_aGIggi9N8DpK, distilled:
//   W    — spine turn that ran a long Bash `Wait for … agent`
//   SIG  — the task-completion signal turn CC re-invoked; it carries REAL
//          content ("明白了。两点都定了") AND emits its own tool_use
//   S2   — the next real turn ("完整判断"); `parentOfS2` is what the write side
//          computes for it — SIG when promoted (linear), W when not (forked)
//   TAIL — the final answer ("完整方案"), the message that disappeared in the UI
const scenario = (parentOfS2: 'SIG' | 'W'): Message[] => [
  { content: 'go', createdAt: 0, id: 'u1', role: 'user', updatedAt: 0 },
  {
    agentId: 'a',
    content: '三个探测都回来了，先给你结论',
    createdAt: 100,
    id: 'W',
    parentId: 'u1',
    role: 'assistant',
    tools: toolArr('bashwait'),
    updatedAt: 100,
  },
  {
    content: 'agent done',
    createdAt: 110,
    id: 'toolW',
    parentId: 'W',
    role: 'tool',
    tool_call_id: 'bashwait',
    updatedAt: 110,
  } as any,
  {
    agentId: 'a',
    content: 'TASKCOMP 明白了。两点都定了',
    createdAt: 120,
    id: 'SIG',
    // Tagged signal at stream_start — but it carries tools, so it is main-chain.
    metadata: {
      signal: { sourceToolCallId: 'bashwait', sourceToolName: 'Bash', type: 'task-completion' },
    } as any,
    parentId: 'toolW',
    role: 'assistant',
    tools: toolArr('bash2'),
    updatedAt: 120,
  },
  {
    content: 'ok',
    createdAt: 125,
    id: 'toolSig',
    parentId: 'SIG',
    role: 'tool',
    tool_call_id: 'bash2',
    updatedAt: 125,
  } as any,
  {
    agentId: 'a',
    content: '现在给你完整判断',
    createdAt: 130,
    id: 'S2',
    parentId: parentOfS2,
    role: 'assistant',
    tools: toolArr('bash3'),
    updatedAt: 130,
  },
  {
    content: 'ok2',
    createdAt: 135,
    id: 'toolS2',
    parentId: 'S2',
    role: 'tool',
    tool_call_id: 'bash3',
    updatedAt: 135,
  } as any,
  {
    agentId: 'a',
    content: 'TAILMARKER 两个开关都定位到了，完整方案',
    createdAt: 140,
    id: 'TAIL',
    parentId: 'S2',
    role: 'assistant',
    updatedAt: 140,
  },
];

describe('signal turn that emits tools — spine promotion (tpc_aGIggi9N8DpK)', () => {
  it('LINEAR (post-fix): the promoted turn keeps the chain whole — tail renders', () => {
    const flat = flatten(scenario('SIG'));
    const json = JSON.stringify(flat);

    // The whole spine collapses into a single assistantGroup; both the
    // task-completion content and the final answer are present.
    expect(json).toContain('TASKCOMP');
    expect(json).toContain('TAILMARKER');

    // The tools-bearing signal turn is NOT folded into a SignalCallbacks
    // accordion (that is only for toolless reactive pushes).
    const group = flat.find((m) => m.role === ('assistantGroup' as any)) as any;
    expect(group).toBeDefined();
    expect(group.signalCallbacks ?? []).toHaveLength(0);
  });

  it('FORKED (pre-fix): S2 re-mounts on the pre-signal spine — both sides of the fork render', () => {
    const flat = flatten(scenario('W'));

    expect(groupStepIds(flat)).toEqual(['W', 'SIG', 'S2', 'TAIL']);
  });
});

/**
 * Observed in a production topic: the main agent left a background search and
 * an async subagent running, said "waiting" without a tool, and ended its turn.
 * CC woke the LLM once per finished task, and each wake-up called a tool before
 * writing its reply. The writer parents every wake-up off the run's latest tool result,
 * so the first one competes with the closing reply under `RUN`.
 *
 * The second wake-up hangs off the first wake-up's tool on a replica that saw the
 * whole run (LINEAR), or off the same `toolWait` when a stale replica opened it
 * (STALE). The final answer was missing from the UI in the STALE shape, and the
 * closing reply was missing in both.
 */
describe('wake-up turns that call tools after a toolless closing reply', () => {
  const wakeUpScenario = (parentOfWake2: 'toolRead1' | 'toolWait'): Message[] => [
    { content: 'go', createdAt: 0, id: 'u1', role: 'user', updatedAt: 0 },
    {
      agentId: 'a',
      content: 'waiting on the code-path analysis',
      createdAt: 100,
      id: 'RUN',
      parentId: 'u1',
      role: 'assistant',
      tools: toolArr('wait'),
      updatedAt: 100,
    },
    {
      content: 'waiting',
      createdAt: 110,
      id: 'toolWait',
      parentId: 'RUN',
      role: 'tool',
      tool_call_id: 'wait',
      updatedAt: 110,
    } as any,
    {
      agentId: 'a',
      content: 'upstream checked, results soon',
      createdAt: 115,
      id: 'REPLY',
      parentId: 'RUN',
      role: 'assistant',
      updatedAt: 115,
    },
    {
      agentId: 'a',
      content: '',
      createdAt: 120,
      id: 'WAKE1',
      metadata: {
        signal: { sourceToolCallId: 'search', sourceToolName: 'Bash', type: 'task-completion' },
      } as any,
      parentId: 'toolWait',
      role: 'assistant',
      tools: toolArr('read1'),
      updatedAt: 120,
    },
    {
      content: 'search output',
      createdAt: 125,
      id: 'toolRead1',
      parentId: 'WAKE1',
      role: 'tool',
      tool_call_id: 'read1',
      updatedAt: 125,
    } as any,
    {
      agentId: 'a',
      content: 'search finished, still waiting on the subagent',
      createdAt: 130,
      id: 'WAKE1_REPLY',
      parentId: 'WAKE1',
      role: 'assistant',
      updatedAt: 130,
    },
    {
      agentId: 'a',
      content: '',
      createdAt: 140,
      id: 'WAKE2',
      metadata: {
        signal: { sourceToolCallId: 'subagent', sourceToolName: 'Agent', type: 'task-completion' },
      } as any,
      parentId: parentOfWake2,
      role: 'assistant',
      tools: toolArr('read2'),
      updatedAt: 140,
    },
    {
      content: 'script source',
      createdAt: 145,
      id: 'toolRead2',
      parentId: 'WAKE2',
      role: 'tool',
      tool_call_id: 'read2',
      updatedAt: 145,
    } as any,
    {
      agentId: 'a',
      content: 'final analysis',
      createdAt: 150,
      id: 'FINAL',
      parentId: 'WAKE2',
      role: 'assistant',
      updatedAt: 150,
    },
  ];

  const everyStep = ['RUN', 'REPLY', 'WAKE1', 'WAKE1_REPLY', 'WAKE2', 'FINAL'];

  /** The contextTree walk follows the same chain rule as the flat list. */
  const contextTreeStepIds = (messages: Message[]): string[] => {
    const groups = parse(messages).contextTree.filter((n) => n.type === 'assistantGroup') as any[];
    expect(groups).toHaveLength(1);
    return groups[0].children.map((step: { id: string }) => step.id);
  };

  it('LINEAR: renders the closing reply and every wake-up in order', () => {
    expect(groupStepIds(flatten(wakeUpScenario('toolRead1')))).toEqual(everyStep);
    expect(contextTreeStepIds(wakeUpScenario('toolRead1'))).toEqual(everyStep);
  });

  it('STALE: renders both wake-ups that share one tool result, final answer included', () => {
    expect(groupStepIds(flatten(wakeUpScenario('toolWait')))).toEqual(everyStep);
    expect(contextTreeStepIds(wakeUpScenario('toolWait'))).toEqual(everyStep);
  });

  // Before the read-side fix the STALE shape ended at WAKE1_REPLY, so a user who
  // kept chatting replied to it, after FINAL already existed.
  it('STALE: keeps a later follow-up sent to the formerly visible tail', () => {
    const messages: Message[] = [
      ...wakeUpScenario('toolWait'),
      {
        content: 'follow-up',
        createdAt: 200,
        id: 'u2',
        parentId: 'WAKE1_REPLY',
        role: 'user',
        updatedAt: 200,
      },
      {
        agentId: 'a',
        content: 'answer',
        createdAt: 210,
        id: 'a2',
        parentId: 'u2',
        role: 'assistant',
        updatedAt: 210,
      },
    ];
    const flat = flatten(messages);

    expect(groupStepIds(flat)).toEqual(everyStep);
    expect(flat.map((m) => m.id)).toEqual(['u1', 'RUN', 'u2', 'a2']);
  });
});
