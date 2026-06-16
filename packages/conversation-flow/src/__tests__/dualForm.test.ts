import { describe, expect, it } from 'vitest';

import { parse } from '../parse';
import type { Message } from '../types/shared';

/**
 * Dual-form message-chain reader (LOBE-10445, phase 1)
 *
 * Two persisted chain shapes must parse to equivalent display output:
 *
 * - **tool-anchored (old)**: the next step's assistant hangs off the
 *   previous step's *last tool result* (`assistant.parent = lastToolMsgIdEver`).
 * - **assistant-anchored (new)**: the next step's assistant hangs off the
 *   *most recent non-tool message* (`assistant.parent = prev assistant/user`),
 *   so a tool result and the next assistant are siblings under one assistant.
 *
 * Invariants the role-aware reader enforces:
 *   1. a `tool` message is always inline data of its assistant (both forms).
 *   2. a branch is ≥2 *non-tool* siblings under one parent.
 *
 * Under both invariants the five fixture classes below — old, new, mixed,
 * parallel-tool, regenerate-branch — must produce the same active flatList.
 */

interface StepSpec {
  content?: string;
  id: string;
  /** tool_call_ids; each spawns a tool-result message `${id}__${tc}` */
  tools?: string[];
}

type Form = 'old' | 'new';

/**
 * Build a single linear multi-step assistant turn in either chain form.
 * Tool-result messages always parent to their calling assistant; only the
 * *next assistant's* parent differs between forms.
 */
const buildTurn = (
  userId: string,
  steps: StepSpec[],
  form: Form,
  agentId = 'agent-a',
): Message[] => {
  const msgs: Message[] = [];
  let clock = 0;

  msgs.push({ content: 'q', createdAt: clock++, id: userId, role: 'user', updatedAt: 0 });

  let prevNonToolId = userId; // new-form anchor: most recent non-tool message
  let lastToolIdEver: string | undefined; // old-form anchor: lastToolMsgIdEver

  steps.forEach((step, i) => {
    const parentId =
      i === 0 ? userId : form === 'old' ? (lastToolIdEver ?? prevNonToolId) : prevNonToolId;

    const assistant: Message = {
      agentId,
      content: step.content ?? '',
      createdAt: clock++,
      id: step.id,
      parentId,
      role: 'assistant',
      updatedAt: 0,
    };
    if (step.tools?.length) {
      assistant.tools = step.tools.map((tc) => ({
        apiName: 'x',
        arguments: '{}',
        id: tc,
        identifier: 'x',
        result_msg_id: `${step.id}__${tc}`,
        type: 'default',
      }));
    }
    msgs.push(assistant);

    for (const tc of step.tools ?? []) {
      const toolId = `${step.id}__${tc}`;
      msgs.push({
        content: 'r',
        createdAt: clock++,
        id: toolId,
        parentId: step.id,
        role: 'tool',
        tool_call_id: tc,
        updatedAt: 0,
      });
      lastToolIdEver = toolId;
    }

    prevNonToolId = step.id;
  });

  return msgs;
};

/** Normalize a flatList into a render-shape comparable across chain forms. */
const shape = (flatList: Message[]) =>
  flatList.map((m) => ({
    childIds: (m as any).children?.map((c: any) => ({
      id: c.id,
      tools: (c.tools ?? []).map((t: any) => t.result_msg_id),
    })),
    id: m.id,
    role: m.role,
  }));

describe('dual-form message chain (LOBE-10445)', () => {
  // Canonical turn: u1 → a1(tc1) → a2(tc2) → a3(final, no tool)
  const canonical: StepSpec[] = [
    { content: 'step1', id: 'a1', tools: ['tc1'] },
    { content: 'step2', id: 'a2', tools: ['tc2'] },
    { content: 'final', id: 'a3' },
  ];

  // Expected: user + one merged assistantGroup holding the whole chain.
  const expectedCanonical = [
    { childIds: undefined, id: 'u1', role: 'user' },
    {
      childIds: [
        { id: 'a1', tools: ['a1__tc1'] },
        { id: 'a2', tools: ['a2__tc2'] },
        { id: 'a3', tools: [] },
      ],
      id: 'a1',
      role: 'assistantGroup',
    },
  ];

  it('① tool-anchored (old) → single merged group', () => {
    const result = parse(buildTurn('u1', canonical, 'old'));
    expect(shape(result.flatList)).toEqual(expectedCanonical);
  });

  it('② assistant-anchored (new) → single merged group', () => {
    const result = parse(buildTurn('u1', canonical, 'new'));
    expect(shape(result.flatList)).toEqual(expectedCanonical);
  });

  it('② new form parses equivalent to old form (flatList + contextTree)', () => {
    const oldR = parse(buildTurn('u1', canonical, 'old'));
    const newR = parse(buildTurn('u1', canonical, 'new'));
    expect(shape(newR.flatList)).toEqual(shape(oldR.flatList));
    // contextTree must also collapse to [message(u1), assistantGroup(a1)] in both forms
    expect(newR.contextTree).toEqual(oldR.contextTree);
    expect(newR.contextTree.map((n) => ({ id: n.id, type: n.type }))).toEqual([
      { id: 'u1', type: 'message' },
      { id: 'a1', type: 'assistantGroup' },
    ]);
  });

  it('③ mixed forms inside one turn → single merged group', () => {
    // a2 attaches old-style (under a1's tool); a3 attaches new-style (under a2)
    const msgs: Message[] = [
      { content: 'q', createdAt: 0, id: 'u1', role: 'user', updatedAt: 0 },
      {
        agentId: 'agent-a',
        content: 'step1',
        createdAt: 1,
        id: 'a1',
        parentId: 'u1',
        role: 'assistant',
        tools: [
          {
            apiName: 'x',
            arguments: '{}',
            id: 'tc1',
            identifier: 'x',
            result_msg_id: 'a1__tc1',
            type: 'default',
          },
        ],
        updatedAt: 0,
      },
      {
        content: 'r',
        createdAt: 2,
        id: 'a1__tc1',
        parentId: 'a1',
        role: 'tool',
        tool_call_id: 'tc1',
        updatedAt: 0,
      },
      {
        agentId: 'agent-a',
        content: 'step2',
        createdAt: 3,
        id: 'a2',
        parentId: 'a1__tc1', // OLD-style: under the tool
        role: 'assistant',
        tools: [
          {
            apiName: 'x',
            arguments: '{}',
            id: 'tc2',
            identifier: 'x',
            result_msg_id: 'a2__tc2',
            type: 'default',
          },
        ],
        updatedAt: 0,
      },
      {
        content: 'r',
        createdAt: 4,
        id: 'a2__tc2',
        parentId: 'a2',
        role: 'tool',
        tool_call_id: 'tc2',
        updatedAt: 0,
      },
      {
        agentId: 'agent-a',
        content: 'final',
        createdAt: 5,
        id: 'a3',
        parentId: 'a2', // NEW-style: under the assistant (sibling of a2__tc2)
        role: 'assistant',
        updatedAt: 0,
      },
    ];
    const result = parse(msgs);
    expect(shape(result.flatList)).toEqual(expectedCanonical);
  });

  it('④ parallel tools then continuation → merged group (both forms)', () => {
    const steps: StepSpec[] = [
      { content: 'step1', id: 'a1', tools: ['tc1', 'tc2'] },
      { content: 'final', id: 'a2' },
    ];
    const expected = [
      { childIds: undefined, id: 'u1', role: 'user' },
      {
        childIds: [
          { id: 'a1', tools: ['a1__tc1', 'a1__tc2'] },
          { id: 'a2', tools: [] },
        ],
        id: 'a1',
        role: 'assistantGroup',
      },
    ];
    expect(shape(parse(buildTurn('u1', steps, 'old')).flatList)).toEqual(expected);
    expect(shape(parse(buildTurn('u1', steps, 'new')).flatList)).toEqual(expected);
  });

  it('⑤ regenerate branch: tool siblings do not inflate branch count', () => {
    // user has TWO assistant branches (regenerate). Branch a-x is a tool group;
    // branch a-y is a plain reply. activeBranchIndex picks a-y.
    const msgs: Message[] = [
      {
        content: 'q',
        createdAt: 0,
        id: 'u1',
        metadata: { activeBranchIndex: 1 },
        role: 'user',
        updatedAt: 0,
      },
      {
        agentId: 'agent-a',
        content: 'branch x',
        createdAt: 1,
        id: 'a-x',
        parentId: 'u1',
        role: 'assistant',
        tools: [
          {
            apiName: 'x',
            arguments: '{}',
            id: 'tcx',
            identifier: 'x',
            result_msg_id: 'a-x__tcx',
            type: 'default',
          },
        ],
        updatedAt: 0,
      },
      {
        content: 'r',
        createdAt: 2,
        id: 'a-x__tcx',
        parentId: 'a-x',
        role: 'tool',
        tool_call_id: 'tcx',
        updatedAt: 0,
      },
      {
        agentId: 'agent-a',
        content: 'branch y',
        createdAt: 3,
        id: 'a-y',
        parentId: 'u1',
        role: 'assistant',
        updatedAt: 0,
      },
    ];
    const result = parse(msgs);
    const ids = result.flatList.map((m) => m.id);
    // active branch is a-y (index 1); a-x's tool result must NOT appear as a peer entry
    expect(ids).toEqual(['u1', 'a-y']);
  });

  // A regenerated continuation in the new form: the tool-using assistant a1 has
  // its tool result PLUS two non-tool assistant children (a2a, a2b). These are a
  // branch, so the active one must be chosen via activeBranchIndex — not the
  // earliest — and the inactive one must not leak into the merged group chain.
  const regenContinuation = (activeBranchIndex: number): Message[] => [
    { content: 'q', createdAt: 0, id: 'u1', role: 'user', updatedAt: 0 },
    {
      agentId: 'agent-a',
      content: 'step1',
      createdAt: 1,
      id: 'a1',
      metadata: { activeBranchIndex },
      parentId: 'u1',
      role: 'assistant',
      tools: [
        {
          apiName: 'x',
          arguments: '{}',
          id: 'tc1',
          identifier: 'x',
          result_msg_id: 'a1__tc1',
          type: 'default',
        },
      ],
      updatedAt: 0,
    },
    {
      content: 'r',
      createdAt: 2,
      id: 'a1__tc1',
      parentId: 'a1',
      role: 'tool',
      tool_call_id: 'tc1',
      updatedAt: 0,
    },
    // two regenerated continuations, both children of a1 (siblings of the tool)
    {
      agentId: 'agent-a',
      content: 'cont A',
      createdAt: 3,
      id: 'a2a',
      parentId: 'a1',
      role: 'assistant',
      updatedAt: 0,
    },
    {
      agentId: 'agent-a',
      content: 'cont B',
      createdAt: 4,
      id: 'a2b',
      parentId: 'a1',
      role: 'assistant',
      updatedAt: 0,
    },
  ];

  it('⑥ assistant-anchored regenerated continuation follows activeBranchIndex', () => {
    // activeBranchIndex 1 → a2b is the active continuation merged into the group
    const r1 = parse(regenContinuation(1));
    expect(shape(r1.flatList)).toEqual([
      { childIds: undefined, id: 'u1', role: 'user' },
      {
        childIds: [
          { id: 'a1', tools: ['a1__tc1'] },
          { id: 'a2b', tools: [] },
        ],
        id: 'a1',
        role: 'assistantGroup',
      },
    ]);
    expect(r1.flatList.map((m) => m.id)).not.toContain('a2a');

    // activeBranchIndex 0 → the OTHER branch (a2a) is active; not blindly earliest-by-rule
    const r0 = parse(regenContinuation(0));
    expect((r0.flatList[1] as any).children.map((c: any) => c.id)).toEqual(['a1', 'a2a']);
    expect(r0.flatList.map((m) => m.id)).not.toContain('a2b');
  });

  it('⑦ async-task summary with assistant-anchored parent stays out of the group', () => {
    // a1 spawns async tasks under its tool; the follow-up summary uses the NEW
    // assistant-anchored parent (summary.parentId === a1). It must render after
    // the tasks aggregation (group → tasks → summary), NOT inside the group.
    const msgs: Message[] = [
      { content: 'q', createdAt: 0, id: 'u1', role: 'user', updatedAt: 0 },
      {
        agentId: 'agent-a',
        content: 'spawning',
        createdAt: 1,
        id: 'a1',
        parentId: 'u1',
        role: 'assistant',
        tools: [
          {
            apiName: 'dispatch',
            arguments: '{}',
            id: 'tc1',
            identifier: 'x',
            result_msg_id: 'a1__tc1',
            type: 'default',
          },
        ],
        updatedAt: 0,
      },
      {
        content: 'r',
        createdAt: 2,
        id: 'a1__tc1',
        parentId: 'a1',
        role: 'tool',
        tool_call_id: 'tc1',
        updatedAt: 0,
      },
      {
        agentId: 'agent-a',
        content: 'task 1',
        createdAt: 3,
        id: 'task-1',
        parentId: 'a1__tc1',
        role: 'task',
        updatedAt: 0,
      },
      {
        agentId: 'agent-a',
        content: 'task 2',
        createdAt: 4,
        id: 'task-2',
        parentId: 'a1__tc1',
        role: 'task',
        updatedAt: 0,
      },
      // assistant-anchored post-task summary
      {
        agentId: 'agent-a',
        content: 'summary',
        createdAt: 5,
        id: 'summary',
        parentId: 'a1',
        role: 'assistant',
        updatedAt: 0,
      },
    ];
    const result = parse(msgs);
    const rows = result.flatList.map((m) => ({ id: m.id, role: m.role }));
    expect(rows).toEqual([
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistantGroup' },
      { id: result.flatList[2].id, role: 'tasks' },
      { id: 'summary', role: 'assistant' },
    ]);
    // the group must contain ONLY a1 — the summary must not be folded inside it
    expect((result.flatList[1] as any).children.map((c: any) => c.id)).toEqual(['a1']);
  });
});
