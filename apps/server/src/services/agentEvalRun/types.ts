import type { LobeChatDatabase } from '@lobechat/database';

import type {
  AgentEvalBenchmarkModel,
  AgentEvalDatasetModel,
  AgentEvalEnvironmentModel,
  AgentEvalExperimentModel,
  AgentEvalRunModel,
  AgentEvalRunTopicModel,
  AgentEvalTestCaseModel,
} from '@/database/models/agentEval';
import type { MessageModel } from '@/database/models/message';
import type { ThreadModel } from '@/database/models/thread';
import type { TopicModel } from '@/database/models/topic';
import type { AgentService } from '@/server/services/agent';

/**
 * What every stage of an eval run works with: the owner it runs as and the
 * models scoped to that owner. `AgentEvalRunService` builds it once and passes
 * it to the stage functions explicitly.
 */
export interface EvalRunDeps {
  agentService: AgentService;
  benchmarkModel: AgentEvalBenchmarkModel;
  datasetModel: AgentEvalDatasetModel;
  db: LobeChatDatabase;
  environmentModel: AgentEvalEnvironmentModel;
  experimentModel: AgentEvalExperimentModel;
  messageModel: MessageModel;
  runModel: AgentEvalRunModel;
  runTopicModel: AgentEvalRunTopicModel;
  testCaseModel: AgentEvalTestCaseModel;
  threadModel: ThreadModel;
  topicModel: TopicModel;
  userId: string;
  workspaceId?: string;
}
