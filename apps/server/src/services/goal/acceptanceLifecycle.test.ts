import type { GoalGraphSnapshot } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { acceptanceEvidenceVersion, currentAcceptanceNode } from './acceptanceLifecycle';

const graph = () =>
  ({
    goal: {
      requirement: 'Deliver evidence',
      config: {
        acceptance: {
          lifecycle: {
            currentNodeId: 'current',
            round: 2,
            evidenceVersion: 'prior',
            history: [{ nodeId: 'old', round: 1, evidenceVersion: 'prior', verdict: 'failed' }],
          },
        },
      },
    },
    nodes: [
      { id: 'old', kind: 'task', title: 'Goal final acceptance', status: 'retired' },
      { id: 'current', kind: 'task', title: 'An independently renamed review', status: 'active' },
    ],
    workVersions: [],
  }) as unknown as GoalGraphSnapshot;

describe('Goal acceptance evidence identity', () => {
  it('uses only the explicit current round and never resurrects history', () => {
    const snapshot = graph();
    expect(currentAcceptanceNode(snapshot)?.id).toBe('current');
    snapshot.goal.config!.acceptance!.lifecycle!.currentNodeId = undefined;
    expect(currentAcceptanceNode(snapshot)).toBeUndefined();
  });

  it('requires changed produced evidence rather than task-container or history changes', () => {
    const snapshot = graph();
    const original = acceptanceEvidenceVersion(snapshot);
    snapshot.workVersions.push({
      nodeId: 'repair',
      relation: 'produced',
      workVersionId: 'task-v2',
      work: { type: 'task' },
    } as never);
    snapshot.nodes[0].status = 'resolved';
    expect(acceptanceEvidenceVersion(snapshot)).toBe(original);
    snapshot.workVersions.push({
      nodeId: 'repair',
      relation: 'produced',
      workVersionId: 'doc-v2',
      work: { type: 'document' },
    } as never);
    expect(acceptanceEvidenceVersion(snapshot)).not.toBe(original);
    const changed = acceptanceEvidenceVersion(snapshot);
    snapshot.workVersions.push({
      nodeId: 'repair-again',
      relation: 'produced',
      workVersionId: 'doc-v2',
      work: { type: 'document' },
    } as never);
    expect(acceptanceEvidenceVersion(snapshot)).toBe(changed);
  });

  it('fences a changed acceptance contract even when artifacts are unchanged', () => {
    const snapshot = graph();
    const original = acceptanceEvidenceVersion(snapshot);
    snapshot.goal.config!.acceptance!.criteriaIds = ['new-clause'];
    expect(acceptanceEvidenceVersion(snapshot)).not.toBe(original);
  });
});
