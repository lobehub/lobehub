import { describe, expect, it } from 'vitest';

import { parse } from '../../parse';
import type { Message } from '../../types';
import { diagnoseTopic } from '../diagnose';

interface Spec {
  content?: string;
  error?: any;
  id: string;
  meta?: Record<string, any>;
  parent?: string;
  reasoning?: any;
  role: 'user' | 'assistant' | 'tool';
  t: number;
  toolCallId?: string;
  tools?: string[];
}

const build = (specs: Spec[]): Message[] =>
  specs.map(
    ({ content, error, id, meta, parent, reasoning, role, t, toolCallId, tools }) =>
      ({
        agentId: 'agt_1',
        content: content ?? '',
        createdAt: t,
        error,
        id,
        metadata: meta,
        parentId: parent,
        reasoning,
        role,
        tool_call_id: toolCallId,
        tools: tools?.map((callId) => ({
          apiName: 'run',
          arguments: '{}',
          id: callId,
          identifier: 'shell',
          type: 'builtin',
        })),
      }) as unknown as Message,
  );

/** Ids the renderer actually surfaces, at any nesting depth. */
const renderedIds = (messages: Message[]): Set<string> => {
  const out = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    for (const key of ['id', 'result_msg_id']) {
      if (typeof record[key] === 'string') out.add(record[key] as string);
    }
    Object.values(record).forEach((v) => v && typeof v === 'object' && walk(v));
  };
  walk(parse(messages).flatList);
  return out;
};

const applyPatch = (messages: Message[], patch: ReturnType<typeof diagnoseTopic>['patch']) =>
  messages.map((m) => {
    const op = patch.find((o) => o.messageId === m.id);
    if (op?.type === 'reparent') return { ...m, parentId: op.parentId };
    if (op?.type === 'set-branch-index')
      return { ...m, metadata: { ...m.metadata, activeBranchIndex: op.index } };
    return m;
  });

describe('diagnoseTopic', () => {
  it('reports nothing for a healthy conversation', () => {
    const messages = build([
      { id: 'u1', role: 'user', t: 0 },
      { content: 'hi', id: 'a1', parent: 'u1', role: 'assistant', t: 10, tools: ['c1'] },
      { content: 'out', id: 't1', parent: 'a1', role: 'tool', t: 20, toolCallId: 'c1' },
      { content: 'done', id: 'a2', parent: 'a1', role: 'assistant', t: 30 },
      { id: 'u2', parent: 'a2', role: 'user', t: 40 },
      { content: 'ok', id: 'a3', parent: 'u2', role: 'assistant', t: 50 },
    ]);

    expect(diagnoseTopic(messages)).toEqual({ hiddenCount: 0, issues: [], patch: [] });
  });

  describe('concurrent fork', () => {
    // A user turn starts while the previous run is still writing: the run's remaining steps
    // and the new turn both hang off the pre-fork anchor, and the reader follows only one.
    const messages = build([
      { id: 'u1', role: 'user', t: 0 },
      { content: 'working', id: 'a1', parent: 'u1', role: 'assistant', t: 10, tools: ['c1'] },
      { content: 'out', id: 't1', parent: 'a1', role: 'tool', t: 20, toolCallId: 'c1' },
      // the run keeps going under a1 …
      { content: 'still working', id: 'a2', parent: 'a1', role: 'assistant', t: 30, tools: ['c2'] },
      { content: 'out', id: 't2', parent: 'a2', role: 'tool', t: 40, toolCallId: 'c2' },
      { content: 'run finished', id: 'a3', parent: 'a2', role: 'assistant', t: 50 },
      // … while the user interjects, also under a1
      { content: 'wait, also do X', id: 'u2', parent: 'a1', role: 'user', t: 35 },
      { content: 'sure', id: 'b1', parent: 'u2', role: 'assistant', t: 45 },
    ]);

    it('detects the fork and hides one of the two branches', () => {
      const { hiddenCount, issues, patch } = diagnoseTopic(messages);

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        kind: 'concurrent-fork',
        messageId: 'a1',
        repairable: true,
      });
      expect(hiddenCount).toBeGreaterThan(0);
      // the user's own turn is what the reader drops
      expect(issues[0].hiddenMessageIds).toEqual(expect.arrayContaining(['u2', 'b1']));

      // repair re-anchors the interjection onto the tail of the run it interrupted
      expect(patch).toEqual([{ messageId: 'u2', parentId: 'a3', type: 'reparent' }]);
    });

    it('makes every message visible again once repaired', () => {
      const { patch } = diagnoseTopic(messages);
      const repaired = applyPatch(messages, patch);

      const rendered = renderedIds(repaired);
      for (const message of repaired) expect(rendered.has(message.id)).toBe(true);
      expect(diagnoseTopic(repaired).issues).toHaveLength(0);
    });
  });

  describe('branches the user chose are left alone', () => {
    it('ignores a regenerated answer', () => {
      const messages = build([
        { id: 'u1', role: 'user', t: 0 },
        { content: 'first try', id: 'a1', parent: 'u1', role: 'assistant', t: 10 },
        { content: 'second try', id: 'a2', parent: 'u1', role: 'assistant', t: 100 },
      ]);

      expect(diagnoseTopic(messages).issues).toHaveLength(0);
    });

    it('ignores a user branching off an earlier message after the run finished', () => {
      // Same shape as a concurrent fork — a user child and an assistant child under one
      // parent — but the subtrees do not overlap in time, so nothing was racing: the user
      // deliberately went back and forked. Time overlap is the only thing separating the two.
      const messages = build([
        { id: 'u1', role: 'user', t: 0 },
        { content: 'working', id: 'a1', parent: 'u1', role: 'assistant', t: 10, tools: ['c1'] },
        { content: 'out', id: 't1', parent: 'a1', role: 'tool', t: 20, toolCallId: 'c1' },
        { content: 'run finished', id: 'a2', parent: 'a1', role: 'assistant', t: 30 },
        // long after the run ended
        { content: 'actually, rewind', id: 'u2', parent: 'a1', role: 'user', t: 1000 },
        { content: 'ok', id: 'b1', parent: 'u2', role: 'assistant', t: 1010 },
      ]);

      expect(diagnoseTopic(messages).issues).toHaveLength(0);
    });
  });

  describe('stale branch index', () => {
    // The client bumps activeBranchIndex ahead of itself while a regenerate is starting. If
    // that run never lands, the index points past every branch and the resolver returns
    // nothing — dropping all of them, including the answer the user already had.
    const messages = build([
      { id: 'u1', meta: { activeBranchIndex: 2 }, role: 'user', t: 0 },
      { content: 'first try', id: 'a1', parent: 'u1', role: 'assistant', t: 10 },
      { content: 'second try', id: 'a2', parent: 'u1', role: 'assistant', t: 100 },
    ]);

    it('detects every branch being dropped', () => {
      const { hiddenCount, issues, patch } = diagnoseTopic(messages);

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        kind: 'stale-branch-index',
        messageId: 'u1',
        repairable: true,
      });
      expect(issues[0].hiddenMessageIds).toEqual(expect.arrayContaining(['a1', 'a2']));
      expect(hiddenCount).toBe(2);
      expect(patch).toEqual([{ index: 1, messageId: 'u1', type: 'set-branch-index' }]);
    });

    it('points the index back at the newest branch that exists', () => {
      const repaired = applyPatch(messages, diagnoseTopic(messages).patch);

      expect(renderedIds(repaired).has('a2')).toBe(true);
      expect(diagnoseTopic(repaired).issues).toHaveLength(0);
    });

    it('leaves an in-bounds index alone, discarded branch and all', () => {
      // a1 is the regenerate the user threw away. It is invisible on purpose.
      const branched = build([
        { id: 'u1', meta: { activeBranchIndex: 1 }, role: 'user', t: 0 },
        { content: 'first try', id: 'a1', parent: 'u1', role: 'assistant', t: 10 },
        { content: 'second try', id: 'a2', parent: 'u1', role: 'assistant', t: 100 },
      ]);

      expect(renderedIds(branched).has('a1')).toBe(false);
      expect(diagnoseTopic(branched).issues).toHaveLength(0);
    });

    it('leaves a stale index above a single child alone', () => {
      // With nothing to choose between, the reader never consults the index — the answer
      // renders fine and there is nothing to repair.
      const single = build([
        { id: 'u1', meta: { activeBranchIndex: 1 }, role: 'user', t: 0 },
        { content: 'the answer', id: 'a1', parent: 'u1', role: 'assistant', t: 10 },
      ]);

      expect(renderedIds(single).has('a1')).toBe(true);
      expect(diagnoseTopic(single).issues).toHaveLength(0);
    });
  });

  describe('a dropped message counts as restorable whenever the user would see it', () => {
    // `hasSubstance` decides whether a repair is worth offering. It has to agree with what the
    // renderer actually puts on screen — a message with no text but an error, or reasoning, is
    // still visible, and reporting that topic as healthy would strand the message for good.
    const branchesOf = (extra: Partial<Spec>) =>
      build([
        { id: 'u1', meta: { activeBranchIndex: 2 }, role: 'user', t: 0 },
        { ...extra, id: 'a1', parent: 'u1', role: 'assistant', t: 10 },
        { ...extra, id: 'a2', parent: 'u1', role: 'assistant', t: 100 },
      ]);

    it.each([
      ['an error and no text', { error: { type: 'PluginServerError' } }],
      ['reasoning and no text', { reasoning: { content: 'thinking…' } }],
    ])('offers a repair for a message carrying %s', (_label, extra) => {
      const messages = branchesOf(extra);

      expect(renderedIds(messages).has('a2')).toBe(false);
      expect(diagnoseTopic(messages).issues).toHaveLength(1);
      expect(diagnoseTopic(messages).patch).toEqual([
        { index: 1, messageId: 'u1', type: 'set-branch-index' },
      ]);
    });

    it('stays quiet when the dropped messages carry only token usage', () => {
      // Nothing to put back on screen — restoring a blank is not a repair.
      const messages = branchesOf({ meta: { usage: { totalTokens: 12 } } });

      expect(diagnoseTopic(messages).issues).toHaveLength(0);
    });
  });

  describe('orphan signal turn', () => {
    const signal = { sourceToolCallId: 'c1', sourceToolName: 'shell', type: 'tool-stdout' };

    it('re-anchors a callback turn the reader drops onto the tool that triggered it', () => {
      // The turn is only really lost when the chain has a competing continuation: the
      // collector filters signal turns out of its candidates, picks the sibling, and the
      // callback is emitted by nobody.
      const messages = build([
        { id: 'u1', role: 'user', t: 0 },
        {
          content: 'running',
          id: 'a1',
          parent: 'u1',
          role: 'assistant',
          t: 10,
          tools: ['c1', 'c2'],
        },
        { content: 'out', id: 't1', parent: 'a1', role: 'tool', t: 20, toolCallId: 'c1' },
        // must hang off t1 (the call the signal names), not a1
        {
          content: 'the task finished, here is the summary',
          id: 's1',
          meta: { signal },
          parent: 'a1',
          role: 'assistant',
          t: 30,
        },
        { content: 'out', id: 't2', parent: 'a1', role: 'tool', t: 40, toolCallId: 'c2' },
        { content: 'final answer', id: 'a2', parent: 'a1', role: 'assistant', t: 50 },
      ]);

      const { issues, patch } = diagnoseTopic(messages);

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        hiddenMessageIds: ['s1'],
        kind: 'orphan-signal-turn',
        messageId: 's1',
        repairable: true,
      });
      // anchored by the signal's own sourceToolCallId, not by "the most recent tool"
      expect(patch).toEqual([{ messageId: 's1', parentId: 't1', type: 'reparent' }]);
      expect(renderedIds(applyPatch(messages, patch)).has('s1')).toBe(true);
    });

    it('leaves a mis-parented callback turn alone when the reader still shows it', () => {
      // Same defect in the tree, but this chain happens to surface it anyway. Rewriting
      // history to fix something the user can already see is churn, not a repair.
      const messages = build([
        { id: 'u1', role: 'user', t: 0 },
        { content: 'running', id: 'a1', parent: 'u1', role: 'assistant', t: 10, tools: ['c1'] },
        { content: 'out', id: 't1', parent: 'a1', role: 'tool', t: 20, toolCallId: 'c1' },
        {
          content: 'saw output',
          id: 's1',
          meta: { signal },
          parent: 'a1',
          role: 'assistant',
          t: 30,
        },
      ]);

      expect(renderedIds(messages).has('s1')).toBe(true);
      expect(diagnoseTopic(messages).issues).toHaveLength(0);
    });
  });

  describe('lost content', () => {
    // Rows the writer created but never filled in. Nothing to re-link and nothing worth
    // deleting — the text never reached the database. Report it, offer no repair.
    it('reports a run of empty shells as unrecoverable', () => {
      const messages = build([
        { id: 'u1', role: 'user', t: 0 },
        { content: 'step', id: 'a1', parent: 'u1', role: 'assistant', t: 10, tools: ['c1'] },
        { content: 'out', id: 't1', parent: 'a1', role: 'tool', t: 20, toolCallId: 'c1' },
        { id: 'shell1', parent: 'a1', role: 'assistant', t: 30 },
        { id: 'shell2', parent: 'shell1', role: 'assistant', t: 40 },
        { id: 'shell3', parent: 'shell2', role: 'assistant', t: 50 },
        { content: 'next question', id: 'u2', parent: 'shell3', role: 'user', t: 60 },
        { content: 'ok', id: 'a2', parent: 'u2', role: 'assistant', t: 70 },
      ]);

      const { issues, patch } = diagnoseTopic(messages);

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        kind: 'lost-content',
        lostMessageIds: ['shell1', 'shell2', 'shell3'],
        messageId: 'shell1',
        repairable: false,
      });
      expect(patch).toHaveLength(0);
    });

    it('ignores a lone turn-final shell', () => {
      const messages = build([
        { id: 'u1', role: 'user', t: 0 },
        { content: 'step', id: 'a1', parent: 'u1', role: 'assistant', t: 10, tools: ['c1'] },
        { content: 'out', id: 't1', parent: 'a1', role: 'tool', t: 20, toolCallId: 'c1' },
        { id: 'shell1', parent: 'a1', role: 'assistant', t: 30 },
        { content: 'next question', id: 'u2', parent: 'shell1', role: 'user', t: 60 },
        { content: 'ok', id: 'a2', parent: 'u2', role: 'assistant', t: 70 },
      ]);

      expect(diagnoseTopic(messages).issues).toHaveLength(0);
    });

    it('never treats a message carrying token usage as a shell', () => {
      const messages = build([
        { id: 'u1', role: 'user', t: 0 },
        { content: 'step', id: 'a1', parent: 'u1', role: 'assistant', t: 10, tools: ['c1'] },
        { content: 'out', id: 't1', parent: 'a1', role: 'tool', t: 20, toolCallId: 'c1' },
        {
          id: 'usageOnly1',
          meta: { usage: { totalTokens: 12 } },
          parent: 'a1',
          role: 'assistant',
          t: 30,
        },
        {
          id: 'usageOnly2',
          meta: { usage: { totalTokens: 34 } },
          parent: 'usageOnly1',
          role: 'assistant',
          t: 40,
        },
        { content: 'done', id: 'a2', parent: 'usageOnly2', role: 'assistant', t: 50 },
      ]);

      expect(diagnoseTopic(messages).issues).toHaveLength(0);
    });
  });
});
