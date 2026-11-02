import { describe, expect, it } from 'vitest';

import type { QuickNoteProposal, QuickNoteTask } from '@/services/quickNote';

import { buildQuickNoteExecutedItems } from './buildExecutedItems';

const createTask = (patch: Partial<QuickNoteTask> = {}): QuickNoteTask => ({
  createdAt: 1000,
  id: 'task-1',
  identifier: 'T-1',
  name: 'Research',
  proposalId: null,
  runId: null,
  status: 'running',
  updatedAt: 1000,
  ...patch,
});

const createProposal = (patch: Partial<QuickNoteProposal> = {}): QuickNoteProposal => ({
  createdAt: 1000,
  decidedAt: 2000,
  decisionStatus: 'accepted',
  id: 'proposal-1',
  kind: 'topic',
  originalPayload: {},
  payload: { openingMessage: 'Hi', title: 'Discuss' },
  resultId: 'topic-1',
  resultType: 'topic',
  updatedAt: 2000,
  validity: 'current',
  ...patch,
});

describe('buildQuickNoteExecutedItems', () => {
  /** @example Tasks open by identifier; applied results open in their native surface. */
  it('merges tasks with applied results, newest first', () => {
    const items = buildQuickNoteExecutedItems(
      [createTask()],
      [
        createProposal(),
        createProposal({
          decidedAt: 3000,
          id: 'p-page',
          kind: 'tool_call',
          payload: { arguments: { markdown: '# Plan' }, title: 'Plan' },
          resultId: 'doc-1',
          resultType: 'page',
        }),
        createProposal({
          decidedAt: 500,
          id: 'p-goal',
          kind: 'goal',
          payload: { requirement: 'Ship', title: 'Launch' },
          resultId: 'goal-1',
          resultType: 'goal',
        }),
      ],
      'inbox-agent',
    );

    expect(items.map(({ key, target, title }) => ({ key, target, title }))).toEqual([
      { key: 'page:doc-1', target: { documentId: 'doc-1', kind: 'document' }, title: 'Plan' },
      {
        key: 'topic:topic-1',
        target: { agentId: 'inbox-agent', kind: 'topic', topicId: 'topic-1' },
        title: 'Discuss',
      },
      { key: 'task:task-1', target: { kind: 'task', taskId: 'T-1' }, title: 'Research' },
      { key: 'goal:goal-1', target: { goalId: 'goal-1', kind: 'goal' }, title: 'Launch' },
    ]);
  });

  /** @example An applied task Proposal whose Task is listed appears once. */
  it('deduplicates applied task proposals against listed tasks', () => {
    const items = buildQuickNoteExecutedItems(
      [createTask()],
      [createProposal({ kind: 'task', resultId: 'task-1', resultType: 'task' })],
    );

    expect(items.map((item) => item.key)).toEqual(['task:task-1']);
  });

  /** @example Pending or dismissed Proposals produced nothing to list. */
  it('skips undecided and dismissed proposals', () => {
    expect(
      buildQuickNoteExecutedItems(
        [],
        [
          createProposal({ decisionStatus: 'pending', resultId: null, resultType: null }),
          createProposal({ decisionStatus: 'dismissed', resultId: null, resultType: null }),
        ],
      ),
    ).toEqual([]);
  });

  /** @example A topic prefers the agent named in its payload; without any agent it cannot open. */
  it('resolves the topic agent from the payload or leaves the row closed', () => {
    const [named] = buildQuickNoteExecutedItems(
      [],
      [createProposal({ payload: { agentId: 'agt-1', openingMessage: 'Hi', title: 'T' } })],
      'inbox-agent',
    );
    const [unknown] = buildQuickNoteExecutedItems([], [createProposal()]);

    expect(named.target).toEqual({ agentId: 'agt-1', kind: 'topic', topicId: 'topic-1' });
    expect(unknown.target).toBeUndefined();
  });
});
