import type { LobeChatDatabase } from '@lobechat/database';
import { buildGoalOverviewContext } from '@lobechat/types';
import debug from 'debug';

import { GoalGraphModel } from '@/database/models/goalGraph';

import type { InternalExecAgentParams } from '../types';

const log = debug('lobe-server:ai-agent-service');

/**
 * Goal-page side conversation: mirror the client executor's injection so
 * server-run agents also answer progress questions from the live graph. A
 * failed read leaves the turn without the overview.
 */
export const buildViewedGoalOverview = async (
  deps: { db: LobeChatDatabase; userId: string; workspaceId?: string },
  appContext: InternalExecAgentParams['appContext'],
) => {
  const goalId = appContext?.viewedGoal?.goalId;
  if (!goalId) return;

  try {
    const snapshot = await new GoalGraphModel(deps.db, deps.userId, deps.workspaceId).getGraph(
      goalId,
    );
    return snapshot ? buildGoalOverviewContext(snapshot) : undefined;
  } catch (error) {
    log('execAgent: failed to build goal overview context: %O', error);
    return;
  }
};
