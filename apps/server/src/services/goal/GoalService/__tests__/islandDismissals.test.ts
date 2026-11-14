// @vitest-environment node
import {
  goalClarificationIslandKey,
  goalDecisionIslandKey,
  goalSignOffIslandKey,
} from '@lobechat/const/goal';
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { UserModel } from '@/database/models/user';
import { GoalRepository } from '@/database/repositories/goal';
import type { LobeChatDatabase } from '@/database/type';

import { GoalCriteriaGeneratorService } from '../../criteriaGenerator';
import type { GoalBriefService } from '../../goalBriefs';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-island-dismissals-user';

registerGoalServiceTestCleanup(serverDB, userId);

const dismiss = (keys: string[]) => new UserModel(serverDB, userId).addIslandDismissals(keys);

describe('GoalService island dismissals', () => {
  it('stops asking a dismissed clarification round on every client, but keeps it on the goal', async () => {
    vi.spyOn(GoalCriteriaGeneratorService.prototype, 'decompose').mockResolvedValue({
      assumptions: [],
      problemStatement: '写发布说明',
      questions: [{ assumption: '终端用户', blocking: true, options: [], question: '给谁看？' }],
      tasks: [{ dependsOn: [], hypothesis: null, instruction: '写', title: '撰写' }],
    });
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ title: 'Release notes' });
    await service.tick(graph.goal.id);
    const [round] = await service.pendingClarifications();

    // Another round of the same goal is a different ask and still shows.
    await dismiss([goalClarificationIslandKey({ goalId: graph.goal.id, questions: [] })]);
    expect(await service.pendingClarifications()).toHaveLength(1);

    await dismiss([goalClarificationIslandKey(round)]);
    // A fresh service stands in for another client of the same account.
    expect(await new GoalService(serverDB, userId).pendingClarifications()).toEqual([]);
    // The question itself is still open, so the goal page keeps asking it.
    const open = await new GoalRepository(serverDB, userId).listPendingClarifications();
    expect(open.map((row) => row.decisionId)).toEqual([round.questions[0].decisionId]);
  });

  it('leaves dismissed gates and sign-offs out of the island list', async () => {
    const decision = (decisionId: string) => ({ decisionId, goalId: 'g1', options: null });
    const service = new GoalService(serverDB, userId);
    const internals = service as unknown as { briefs: GoalBriefService; goalModel: GoalRepository };
    vi.spyOn(internals.goalModel, 'listPendingDecisions').mockResolvedValue([
      decision('d1'),
      decision('d2'),
    ] as any);
    vi.spyOn(internals.briefs, 'listOpenSignOffs').mockResolvedValue([
      { acceptanceId: 'a1' },
      { acceptanceId: 'a2' },
    ] as any);

    await dismiss([goalDecisionIslandKey('d1'), goalSignOffIslandKey('a2')]);

    const island = await service.pendingForIsland();
    expect(island.decisions.map((row) => row.decisionId)).toEqual(['d2']);
    expect(island.signOffs.map((row) => row.acceptanceId)).toEqual(['a1']);
  });
});
