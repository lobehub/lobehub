import type { GoalGraphSnapshot } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { planUnitBrief } from './batchPlanSkill';
import { buildReleaseGateDossier, withUnitWorks } from './releaseGate';

const { listSummariesByIds } = vi.hoisted(() => ({ listSummariesByIds: vi.fn() }));
vi.mock('@/database/models/work', () => ({
  WorkModel: class {
    listSummariesByIds = listSummariesByIds;
  },
}));

const plan = {
  outline: '# Recipe\n\nMove each read to the replica.',
  skill: { id: 'skill_1', name: 'migrate-reads-to-replica' },
};

const graphWith = (
  nodes: { description: string; id: string; title: string }[],
  workVersions: unknown[] = [],
) =>
  ({
    goal: {
      config: {
        rollout: { spec: { recipeOutline: plan.outline } },
        rolloutState: {
          batchNodeId: 'batch',
          phase: 'probe',
          probeNodeIds: nodes.map((node) => node.id),
          waveIndex: 0,
        },
      },
      title: 'Migrate reads',
    },
    nodes: nodes.map((node) => ({ ...node, status: 'resolved' })),
    workVersions,
  }) as unknown as GoalGraphSnapshot;

describe('buildReleaseGateDossier', () => {
  /**
   * Regression: a unit's brief was its whole task description, so the review
   * panel showed the plan-skill instruction and a second copy of the plan
   * instead of what this unit itself had to do.
   */
  it("reports a unit's own brief, not the plan instruction every unit carries", () => {
    const dossier = buildReleaseGateDossier(
      graphWith([
        { description: planUnitBrief('Home inbox', plan), id: 'n1', title: 'Home inbox' },
        {
          description: 'Migrate `useInbox`; cold start must render cached.',
          id: 'n2',
          title: 'Brief',
        },
      ]),
      { kind: 'probes', waveSize: 5 },
    );

    expect(dossier?.units.find((unit) => unit.nodeId === 'n1')?.brief).toBeUndefined();
    expect(dossier?.units.find((unit) => unit.nodeId === 'n2')?.brief).toBe(
      'Migrate `useInbox`; cold start must render cached.',
    );
  });

  /**
   * Regression: a unit's pull request reached the review as a bare title link,
   * with no number or state, so the owner could not tell what to merge.
   */
  it("carries each output's reference and state", () => {
    const dossier = buildReleaseGateDossier(
      graphWith(
        [{ description: 'Migrate inbox reads.', id: 'n1', title: 'Home inbox' }],
        [
          {
            nodeId: 'n1',
            work: {
              identifier: '#22737',
              resourceId: 'lobehub/lobehub#22737',
              resourceType: 'github_pull_request',
              status: 'open',
              title: 'Move inbox reads to replica',
              type: 'external',
              url: 'https://github.com/lobehub/lobehub/pull/22737',
              workId: 'work_1',
            },
          },
        ],
      ),
      { kind: 'probes', waveSize: 5 },
    );

    expect(dossier?.units[0].artifacts).toEqual([
      {
        identifier: '#22737',
        resourceType: 'github_pull_request',
        status: 'open',
        title: 'Move inbox reads to replica',
        type: 'external',
        url: 'https://github.com/lobehub/lobehub/pull/22737',
        workId: 'work_1',
      },
    ]);
  });
});

describe('withUnitWorks', () => {
  const dossier = {
    units: [
      { artifacts: [{ title: 'PR', type: 'external', workId: 'work_1' }], nodeId: 'n1' },
      { artifacts: [], nodeId: 'n2' },
    ],
  } as any;

  /**
   * Regression: the review drew its own output rows instead of the Work cards
   * the conversation shows, because the dossier carried no Work summaries.
   */
  it("freezes each unit's outputs as Work summary cards", async () => {
    listSummariesByIds.mockResolvedValueOnce([{ id: 'work_1', title: 'PR' }]);
    const frozen = await withUnitWorks({} as any, { userId: 'u' }, dossier);
    expect(listSummariesByIds).toHaveBeenCalledWith(['work_1']);
    expect(frozen.units[0].works).toEqual([{ id: 'work_1', title: 'PR' }]);
    expect(frozen.units[1].works).toBeUndefined();
  });

  it('keeps the plain artifact list when the read fails', async () => {
    listSummariesByIds.mockRejectedValueOnce(new Error('db down'));
    expect(await withUnitWorks({} as any, { userId: 'u' }, dossier)).toBe(dossier);
  });
});
