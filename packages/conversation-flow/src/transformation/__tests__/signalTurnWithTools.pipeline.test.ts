import { describe, expect, it } from 'vitest';

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
 * These tests pin the read side's behavior on both shapes, proving the write-side
 * promotion is load-bearing:
 *   - LINEAR (post-fix): the whole spine renders, tail included.
 *   - FORKED (pre-fix):  the reader walks into the signal branch at the fork and
 *                        DROPS the tail — exactly the bug the promotion prevents.
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

  it('FORKED (pre-fix): S2 re-mounts on the pre-signal spine — reader DROPS the tail', () => {
    const flat = flatten(scenario('W'));
    const json = JSON.stringify(flat);

    // The signal branch still renders …
    expect(json).toContain('TASKCOMP');
    // … but everything after the fork (the real conclusion) silently vanishes —
    // the exact symptom the write-side promotion eliminates.
    expect(json).not.toContain('TAILMARKER');
  });
});
