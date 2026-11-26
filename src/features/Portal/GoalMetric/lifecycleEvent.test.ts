import type { GoalEventType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { nodeTwinKey, presentLifecycleEvent } from './lifecycleEvent';

const ctx = (types: Record<string, string> = {}, hasNodeTwin = false) => ({
  hasNodeTwin,
  workTypeOf: (id: string) => types[id],
});

const node = (reason: string | null, eventType: GoalEventType = 'updated') => ({
  entityType: 'node' as const,
  eventType,
  reason,
});

describe('presentLifecycleEvent', () => {
  it('hides the task registering its own task Work', () => {
    expect(
      presentLifecycleEvent(node('Attached Work version v1 as produced'), ctx({ v1: 'task' })),
    ).toEqual({ hidden: true });
  });

  it('shows a delivered Work as the object of a "produced" row', () => {
    expect(
      presentLifecycleEvent(node('Attached Work version v2 as produced'), ctx({ v2: 'document' })),
    ).toEqual({ action: 'work.produced', workVersion: { id: 'v2', relation: 'produced' } });
  });

  it('keeps an attached Work whose row is gone rather than hiding it', () => {
    expect(presentLifecycleEvent(node('Attached Work version v3 as supports'), ctx())).toEqual({
      action: 'work.supports',
      workVersion: { id: 'v3', relation: 'supports' },
    });
  });

  it('drops reasons that only restate the verb', () => {
    expect(presentLifecycleEvent(node('Responsible task completed', 'resolved'), ctx())).toEqual(
      {},
    );
  });

  it('reads a canceled task as such and keeps only the main Agent diagnosis', () => {
    expect(
      presentLifecycleEvent(node('Task canceled — main Agent: stuck on a duplicate node'), ctx()),
    ).toEqual({
      action: 'taskCanceled',
      note: { key: 'mainAgent', text: 'stuck on a duplicate node' },
    });
    expect(presentLifecycleEvent(node('Task canceled'), ctx())).toEqual({
      action: 'taskCanceled',
    });
  });

  it('hides the goal row a failure gate writes alongside its task row', () => {
    expect(
      presentLifecycleEvent(
        { entityType: 'goal', eventType: 'updated', reason: 'Task canceled' },
        ctx({}, true),
      ),
    ).toEqual({ hidden: true });
  });

  it('names pausing and resuming the goal', () => {
    expect(
      presentLifecycleEvent(
        { entityType: 'goal', eventType: 'updated', reason: 'paused by user' },
        ctx(),
      ),
    ).toEqual({ action: 'paused' });
    expect(
      presentLifecycleEvent(
        {
          entityType: 'goal',
          eventType: 'updated',
          reason: 'Goal or main Agent turn budget exhausted',
        },
        ctx(),
      ),
    ).toEqual({ action: 'paused', note: { key: 'budgetExhausted' } });
    expect(
      presentLifecycleEvent(
        { entityType: 'goal', eventType: 'activated', reason: 'resumed by user' },
        ctx(),
      ),
    ).toEqual({ action: 'resumed' });
  });

  it('translates fixed recovery reasons', () => {
    expect(
      presentLifecycleEvent(
        node('Recovered an abandoned Task operation and started the next attempt', 'activated'),
        ctx(),
      ),
    ).toEqual({ note: { key: 'recoveredAbandoned' } });
  });

  it.each([
    'Started by the goal agent',
    'Started by the owner',
    'automatic recovery started a run',
    'decision "Ship it?" resolved: approve',
    'decomposition claimed',
    'dispatched T-12',
    'nodes retired by user',
    'reclaimed an abandoned Task',
    'status planning → running',
  ])('drops the internal reason %s but keeps its row', (reason) => {
    expect(
      presentLifecycleEvent({ entityType: 'goal', eventType: 'activated', reason }, ctx()),
    ).toEqual({});
  });

  it.each([
    [
      'A planning run that started after the Goal was closed could not be stopped; close the Goal again to stop it',
      'lateRunUnstoppable',
    ],
    ['Budget exhausted before graph exploration', 'explorationBudget'],
    ['Deadline passed (2026-12-01); no new Task will be dispatched', 'deadlinePassed'],
    ['Exploration planning failed; resume to retry.', 'explorationFailed'],
    ['Folded into the batch before start', 'foldedIntoBatch'],
    ['Goal renamed', 'goalRenamed'],
    ['Goal report submitted', 'reportSubmitted'],
    ['Plan sent back to the main Agent', 'planSentBack'],
    ['Planner refined the description', 'descriptionRefined'],
    ['Release approved', 'releaseApproved'],
    ['Responsible task is missing', 'taskMissing'],
    ['Stopping Goal before closing', 'stoppingBeforeClose'],
    ['Stopping Goal before deletion', 'stoppingBeforeDelete'],
    [
      'The main Agent could not take the plan revision; resume the goal once it can, and the correction goes to it again',
      'planRevisionFailed',
    ],
    ['Writing the Goal report (completed)', 'reportWriting'],
    ['a decision gate is open', 'decisionPending'],
    ['a measurement cleared the acceptance gate', 'measurementCleared'],
    ['no eligible task to advance', 'noEligibleTask'],
    ['superseded by a new recipe revision', 'recipeSuperseded'],
  ])('translates the coordinator reason %s', (reason, key) => {
    expect(presentLifecycleEvent(node(reason), ctx())).toEqual({ note: { key } });
  });

  it.each([
    [
      'Measured acceptance not met: revenue >= 100 (no observation)',
      { detail: 'revenue >= 100 (no observation)', key: 'measuredNotMet' },
    ],
    [
      'Batch pattern break needs a decision: 2 units failed',
      { detail: '2 units failed', key: 'patternBreak' },
    ],
    [
      'Batch release needs approval: wave 1 passed',
      { detail: 'wave 1 passed', key: 'releaseReview' },
    ],
    [
      'Experiment limit reached (3/3); goal is not yet accepted. No branch left to try',
      { detail: 'No branch left to try', key: 'experimentLimit', max: '3', used: '3' },
    ],
    [
      'Experiment node_1 already ran 2 corrected protocols; the planner asked for another. Resume to replan.',
      { count: 2, key: 'revisionLimit' },
    ],
    [
      'Retired with its prerequisite "Collect the data"',
      { key: 'retiredWithPrerequisite', title: 'Collect the data' },
    ],
  ])('keeps the generated detail of %s', (reason, note) => {
    expect(presentLifecycleEvent(node(reason), ctx())).toEqual({ note });
  });

  it.each([
    ['bound to topic tpc_new', { hidden: true }],
    ['bound to topic tpc_new (moved from agent agt_old)', { hidden: true }],
    ['bound to topic tpc_new; goal agent none → agt_new', { hidden: true }],
    ['bound to topic tpc_new (moved from topic tpc_old)', { note: { key: 'topicMoved' } }],
    ['bound to topic tpc_new; goal agent agt_old → agt_new', { note: { key: 'agentChanged' } }],
  ])('reads the conversation binding %s without its ids', (reason, presentation) => {
    expect(
      presentLifecycleEvent({ entityType: 'goal', eventType: 'updated', reason }, ctx()),
    ).toEqual(presentation);
  });

  it('strips the CLI resume hint from a pause reason', () => {
    expect(
      presentLifecycleEvent(
        {
          entityType: 'goal',
          eventType: 'updated',
          reason: 'Goal or main Agent turn budget exhausted. Resume with: lh goal resume goal_1',
        },
        ctx(),
      ),
    ).toEqual({ action: 'paused', note: { key: 'budgetExhausted' } });
    expect(
      presentLifecycleEvent(
        {
          entityType: 'goal',
          eventType: 'updated',
          reason: 'Main Agent device stayed offline. Resume with: lh goal resume goal_1',
        },
        ctx(),
      ),
    ).toEqual({ note: { text: 'Main Agent device stayed offline' } });
  });

  it('keeps an unrecognised reason as written', () => {
    expect(presentLifecycleEvent(node('Narrowed the scope to paid users'), ctx())).toEqual({
      note: { text: 'Narrowed the scope to paid users' },
    });
  });
});

describe('nodeTwinKey', () => {
  it('matches events written in the same second with the same reason', () => {
    const a = nodeTwinKey({ createdAt: new Date('2026-09-28T01:51:00.100Z'), reason: 'x' });
    const b = nodeTwinKey({ createdAt: new Date('2026-09-28T01:51:00.900Z'), reason: 'x' });
    expect(a).toBe(b);
  });
});
