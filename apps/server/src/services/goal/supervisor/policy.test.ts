import type { GoalGraphSnapshot, GoalItem, GoalSupervisionState, TaskItem } from '@lobechat/types';
import { summarizeGoalSupervision } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { AgentOperationItem } from '@/database/schemas/agentOperations';
import { humanizeHeteroDispatchError } from '@/server/services/aiAgent/helpers/heteroErrors';

import { recoveryEligibility, statusAuthoredByActor } from './policy';

const graph = {
  decisions: [],
  nodes: [],
  edges: [],
  events: [],
  workVersions: [],
  goal: { config: { supervision: { enabled: true } }, status: 'running' } as GoalItem,
} as GoalGraphSnapshot;
const task = { status: 'failed', totalTopics: 1 } as TaskItem;
const operation = {
  completionReason: 'error',
  error: { message: 'fetch failed: ECONNRESET' },
  status: 'error',
} as AgentOperationItem;

describe('supervisor recovery authority', () => {
  it('allows a confirmed transport failure with attempts remaining', () => {
    expect(recoveryEligibility(graph, task, operation).eligible).toBe(true);
  });

  it.each([
    'InvalidProviderAPIKey',
    'authentication failed after network error',
    'quota exceeded 503',
    'approval required',
    'cancelled ECONNRESET',
  ])('keeps %s outside recovery authority', (error) => {
    expect(recoveryEligibility(graph, { ...task, error }, operation).eligible).toBe(false);
  });

  it.each(['paused', 'canceled', 'achieved', 'review'])('respects Goal %s', (status) => {
    expect(
      recoveryEligibility(
        { ...graph, goal: { ...graph.goal, status } as GoalItem },
        task,
        operation,
      ).eligible,
    ).toBe(false);
  });

  it('does not interpret a running, cancelled or unknown failure as recoverable', () => {
    expect(recoveryEligibility(graph, { ...task, status: 'canceled' }, operation).eligible).toBe(
      false,
    );
    expect(recoveryEligibility(graph, task, { ...operation, status: 'running' }).eligible).toBe(
      false,
    );
    expect(
      recoveryEligibility(graph, task, { ...operation, error: { message: 'unknown error' } })
        .eligible,
    ).toBe(false);
    expect(
      recoveryEligibility(graph, task, { ...operation, completionReason: 'max_steps' }).eligible,
    ).toBe(false);
  });

  const settled = { completionReason: 'done', status: 'done' } as AgentOperationItem;

  it('recovers a dispatch the gateway says never started, in either stored shape', () => {
    // The run finished or never began and the device link broke around it, so there is
    // no errored operation to read: the dispatch failure is the only evidence. It
    // reaches storage as a raw code from the coordinator's dispatch and as the
    // humanized headline once the runtime finalizes it.
    for (const error of [
      '{"error":"DEVICE_OFFLINE","success":false}',
      'DEVICE_GATEWAY_RATE_LIMITED',
      // A gateway 500 lands here, outside the transport regex's 502-504.
      'DEVICE_GATEWAY_ERROR (HTTP 500)',
      humanizeHeteroDispatchError('DEVICE_OFFLINE'),
      humanizeHeteroDispatchError('DEVICE_GATEWAY_UNREACHABLE'),
      humanizeHeteroDispatchError('DEVICE_GATEWAY_ERROR'),
    ])
      expect(
        recoveryEligibility(graph, { ...task, error, status: 'paused' }, settled).eligible,
      ).toBe(true);
  });

  it('keeps a dispatch failure a retry cannot fix, or whose outcome is unknown, with a person', () => {
    for (const error of [
      'DEVICE_GATEWAY_UNAUTHORIZED',
      'GATEWAY_NOT_CONFIGURED',
      'DEVICE_RESPONSE_TIMEOUT',
      humanizeHeteroDispatchError('DEVICE_RESPONSE_TIMEOUT'),
      humanizeHeteroDispatchError('GATEWAY_NOT_CONFIGURED'),
    ])
      expect(
        recoveryEligibility(graph, { ...task, error, status: 'paused' }, settled).eligible,
      ).toBe(false);
  });

  it('leaves a status a person wrote to the person, whatever the error says', () => {
    const errored = { ...operation, error: { message: 'ECONNRESET' } } as AgentOperationItem;
    // The run genuinely errored and the Task was paused with recoverable text; a
    // person then marked it failed without supplying a new error, so the text stayed.
    // Only the transition's author separates this from the failure it looks like.
    expect(recoveryEligibility(graph, task, errored, true).eligible).toBe(false);
    expect(recoveryEligibility(graph, task, errored, false).eligible).toBe(true);
    // Same for a dispatch failure a person closed out.
    const stalled = { ...task, error: '{"error":"DEVICE_OFFLINE","success":false}' };
    expect(recoveryEligibility(graph, stalled, settled, true).eligible).toBe(false);
    expect(recoveryEligibility(graph, { ...stalled, status: 'paused' }, settled).eligible).toBe(
      true,
    );
  });

  it('still refuses a pipeline failure that a person or a limit caused', () => {
    expect(
      recoveryEligibility(
        graph,
        { ...task, error: 'device unauthorized', status: 'paused' },
        settled,
      ).eligible,
    ).toBe(false);
    expect(
      recoveryEligibility(graph, { ...task, status: 'paused' }, {
        ...settled,
        completionReason: 'cost_limit',
      } as AgentOperationItem).eligible,
    ).toBe(false);
    expect(
      recoveryEligibility(graph, { ...task, totalTopics: 3, status: 'paused' }, settled).eligible,
    ).toBe(false);
  });

  it('respects attempt exhaustion and explicit manual decisions', () => {
    expect(recoveryEligibility(graph, { ...task, totalTopics: 3 }, operation).eligible).toBe(false);
    expect(
      recoveryEligibility(
        { ...graph, decisions: [{ status: 'pending' }] } as GoalGraphSnapshot,
        task,
        operation,
      ).eligible,
    ).toBe(false);
  });
});

describe('status provenance', () => {
  const act = (over: Record<string, unknown> = {}) => ({
    actorAgentId: null,
    actorUserId: null,
    payload: { to: 'failed' },
    type: 'status',
    ...over,
  });

  it('reads the author of the transition that produced the current status', () => {
    expect(statusAuthoredByActor([act({ actorUserId: 'u1' })], 'failed')).toBe(true);
    expect(statusAuthoredByActor([act({ actorAgentId: 'a1' })], 'failed')).toBe(true);
    // The pipeline writes without an actor.
    expect(statusAuthoredByActor([act()], 'failed')).toBe(false);
    // A later pipeline transition supersedes an earlier authored one.
    expect(
      statusAuthoredByActor(
        [act({ actorUserId: 'u1' }), act({ payload: { to: 'paused' } })],
        'paused',
      ),
    ).toBe(false);
    // An authored move somewhere else does not speak for this status.
    expect(statusAuthoredByActor([act({ actorUserId: 'u1' })], 'paused')).toBe(false);
    expect(statusAuthoredByActor([], 'failed')).toBe(false);
    // Assignee changes are not status provenance.
    expect(
      statusAuthoredByActor([act({ actorUserId: 'u1', type: 'assignee_user' })], 'failed'),
    ).toBe(false);
    // Deleting the actor clears the id columns, so "someone who is gone" would read
    // as the system without the durable kind written beside them.
    expect(
      statusAuthoredByActor([act({ payload: { actorKind: 'agent', to: 'failed' } })], 'failed'),
    ).toBe(true);
    expect(
      statusAuthoredByActor([act({ payload: { actorKind: 'user', to: 'failed' } })], 'failed'),
    ).toBe(true);
    expect(
      statusAuthoredByActor([act({ payload: { actorKind: 'system', to: 'failed' } })], 'failed'),
    ).toBe(false);
  });
});

describe('effective recovery metric', () => {
  it('does not count a diagnosis, restart or human continuation as an effective recovery', () => {
    const state = {
      incidents: [
        { eligible: true, status: 'diagnosing' },
        { eligible: true, status: 'retrying' },
        { eligible: true, status: 'human_resumed' },
        { eligible: true, status: 'unsuccessful' },
        { eligible: true, status: 'recovered' },
        { eligible: false, status: 'escalated' },
      ],
    } as GoalSupervisionState;
    expect(summarizeGoalSupervision(state)).toEqual({
      effectiveRecoveries: 1,
      effectiveRecoveryRate: 0.2,
      eligibleInterruptions: 5,
      escalated: 1,
      interruptions: 6,
      pendingRecoveries: 2,
    });
    expect(summarizeGoalSupervision().effectiveRecoveryRate).toBeNull();
  });
});
