import type { LobeChatDatabase } from '@lobechat/database';

import {
  AgentEvalBenchmarkModel,
  AgentEvalDatasetModel,
  AgentEvalExperimentModel,
  AgentEvalRunModel,
  AgentEvalRunTopicModel,
  AgentEvalTestCaseModel,
} from '@/database/models/agentEval';
import { MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { AgentService } from '@/server/services/agent';

import type { EvalRunDeps } from './types';

/**
 * Builds the owner-scoped models every eval run stage works with. Used by the
 * `AgentEvalRunService` constructor and by completion hooks that need a fresh
 * set of models without importing the service class (which would be circular).
 */
export const createEvalRunDeps = (
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): EvalRunDeps => {
  // Built in the order the class constructed its models before the split.
  const runModel = new AgentEvalRunModel(db, userId, workspaceId);
  const benchmarkModel = new AgentEvalBenchmarkModel(db, userId, workspaceId);
  const datasetModel = new AgentEvalDatasetModel(db, userId, workspaceId);
  const experimentModel = new AgentEvalExperimentModel(db, userId, workspaceId);
  const runTopicModel = new AgentEvalRunTopicModel(db, userId, workspaceId);
  const testCaseModel = new AgentEvalTestCaseModel(db, userId, workspaceId);
  const messageModel = new MessageModel(db, userId, workspaceId);
  const threadModel = new ThreadModel(db, userId, workspaceId);
  const topicModel = new TopicModel(db, userId, workspaceId);
  const agentService = new AgentService(db, userId, workspaceId);

  return {
    agentService,
    benchmarkModel,
    datasetModel,
    db,
    experimentModel,
    messageModel,
    runModel,
    runTopicModel,
    testCaseModel,
    threadModel,
    topicModel,
    userId,
    workspaceId,
  };
};
