import { describe, expect, it } from 'vitest';

import {
  GoalAdvanceResultSchema,
  GoalGraphSchema,
  GoalGraphSnapshotSchema,
  GoalListResponseSchema,
  GoalSupervisionSchema,
} from './goal.type';

// Services return the page's rows and total; the controller adds `hasMore`/`nextCursor`.
const SERVICE_PAGE_FIELDS = { hasMore: true, nextCursor: true } as const;

/** What `c.json` does to a payload: Dates become ISO strings, `undefined` keys vanish. */
// A JSON round trip on purpose: `structuredClone` would keep the Dates the wire turns into strings.
// eslint-disable-next-line unicorn/prefer-structured-clone
const wire = <T>(value: T) => JSON.parse(JSON.stringify(value));

const now = new Date('2026-11-17T08:00:00.000Z');

const goalRow = {
  agentId: 'agt-1',
  archivedAt: null,
  completedAt: null,
  config: { supervision: { enabled: true } },
  createdAt: now,
  deletedAt: null,
  id: 'goal-1',
  isDeleted: null,
  maxRounds: null,
  maxTotalCost: 5,
  projectId: null,
  requirement: 'Ship it',
  startedAt: now,
  status: 'running',
  subjectId: null,
  subjectType: 'standalone',
  title: 'Ship the personal agent',
  updatedAt: now,
  userId: 'user-1',
  visibility: 'public',
  workspaceId: null,
};

const snapshot = {
  decisions: [
    {
      accessedAt: now,
      authority: 'user',
      canceledAt: null,
      createdAt: now,
      id: 'dec-1',
      nodeId: 'node-2',
      options: [{ effect: 'retry', id: 'retry', label: 'Retry' }],
      question: 'Retry the task?',
      recommendedOptionId: 'retry',
      requestedProjectRole: null,
      requestedUserId: null,
      resolution: null,
      resolvedAt: null,
      resolvedByAgentId: null,
      resolvedByUserId: null,
      resolvedOptionId: null,
      status: 'pending',
      updatedAt: now,
    },
  ],
  edges: [
    {
      createdAt: now,
      goalId: 'goal-1',
      id: 'edge-1',
      kind: 'depends_on',
      sourceNodeId: 'node-1',
      targetNodeId: 'node-2',
    },
  ],
  events: [
    {
      actorId: 'user-1',
      actorType: 'user',
      createdAt: now,
      entityId: 'goal-1',
      entityType: 'goal',
      eventType: 'created',
      goalId: 'goal-1',
      id: 'evt-1',
      operationId: null,
      reason: null,
      taskId: null,
    },
  ],
  goal: goalRow,
  nodes: [
    {
      accessedAt: now,
      confidence: '0.800',
      createdAt: now,
      createdByAgentId: null,
      createdByUserId: 'user-1',
      description: null,
      goalId: 'goal-1',
      id: 'node-1',
      kind: 'task',
      priority: 0,
      resolvedAt: null,
      status: 'active',
      taskId: 'task-1',
      title: 'Draft the plan',
      updatedAt: now,
    },
  ],
  workVersions: [
    {
      createdAt: now,
      id: 'link-1',
      nodeId: 'node-1',
      relation: 'produced',
      work: {
        identifier: null,
        resourceId: 'doc-1',
        status: null,
        title: 'Plan',
        type: 'document',
        url: null,
        workId: 'work-1',
      },
      workVersionId: 'wv-1',
    },
  ],
};

describe('goal response schemas', () => {
  it('accepts a write-path graph snapshot as it leaves the API', () => {
    expect(() => GoalGraphSnapshotSchema.parse(wire(snapshot))).not.toThrow();
  });

  it('accepts a fetched graph with its read-time roll-ups', () => {
    const graph = {
      ...snapshot,
      acceptances: { 'node-1': { id: 'acc-1', status: 'verifying' } },
      assignees: { 'node-1': 'agt-2' },
      metricCriteria: { allMet: false, criteria: [] },
      runHeartbeats: { 'node-1': now },
      spend: {
        byTask: [
          {
            runs: 1,
            taskId: 'task-1',
            totalCost: 0.1,
            totalInputTokens: 10,
            totalOutputTokens: 5,
            totalTokens: 15,
          },
        ],
        runs: 1,
        totalCost: 0.1,
        totalInputTokens: 10,
        totalOutputTokens: 5,
        totalTokens: 15,
      },
    };

    expect(() => GoalGraphSchema.parse(wire(graph))).not.toThrow();
  });

  it('refuses a graph that drops the spend roll-up `graph()` always attaches', () => {
    expect(GoalGraphSchema.safeParse(wire(snapshot)).success).toBe(false);
  });

  it('accepts the list roll-up rows', () => {
    const list = {
      goals: [
        {
          findingCount: 0,
          goal: goalRow,
          pendingDecisions: 1,
          signedOff: false,
          taskDone: 0,
          taskTotal: 1,
          totalRunCost: 0,
          totalRunDuration: 0,
        },
      ],
      total: 1,
    };

    expect(() => GoalListResponseSchema.omit(SERVICE_PAGE_FIELDS).parse(wire(list))).not.toThrow();
  });

  it('accepts supervision with and without a ledger', () => {
    expect(() => GoalSupervisionSchema.parse({ enabled: false })).not.toThrow();
    expect(() =>
      GoalSupervisionSchema.parse({
        enabled: true,
        state: { agentId: 'agt-1', incidents: [], revision: 1, topicId: 'tpc-1' },
      }),
    ).not.toThrow();
  });

  it('accepts the advance outcome with its tick count', () => {
    expect(() =>
      GoalAdvanceResultSchema.parse({
        goalId: 'goal-1',
        message: 'waiting on a person',
        outcome: 'waiting_human',
        ticks: 2,
      }),
    ).not.toThrow();
  });
});
