import { randomUUID } from 'node:crypto';

import type { ISnapshotStore } from '@lobechat/agent-tracing';
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import {
  UnderstandingResourceNotFoundError,
  UnderstandingResultRepository,
  UnderstandingSessionRepository,
} from '@lobechat/database';

import { AgentModel } from '@/database/models/agent';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime';
import { AiAgentService } from '@/server/services/aiAgent';

import { UnderstandingOrchestrator } from './orchestrator';
import {
  builtinUnderstandingProviderRegistrations,
  materializeUnderstandingProviders,
} from './providers';
import { UnderstandingSourceStore } from './sourceStore';
import type { UnderstandingProviderRegistration } from './types';

const understandingSnapshotStore = {
  get: async () => null,
  getLatest: async () => null,
  list: async () => [],
  listPartials: async () => [],
  loadPartial: async () => null,
  removePartial: async () => undefined,
  save: async () => undefined,
  savePartial: async () => undefined,
} satisfies ISnapshotStore;

interface CreateUnderstandingOrchestratorOptions {
  db: LobeChatDatabase;
  registrations?: readonly UnderstandingProviderRegistration[];
  userId: string;
  workspaceId?: string;
}

export const createUnderstandingOrchestrator = async ({
  db,
  userId,
  workspaceId,
  registrations = builtinUnderstandingProviderRegistrations,
}: CreateUnderstandingOrchestratorOptions): Promise<UnderstandingOrchestrator> => {
  if (workspaceId) throw new Error('Onboarding Understanding is available only in personal scope');
  const agent = await new AgentModel(db, userId).getBuiltinAgent(
    BUILTIN_AGENT_SLUGS.onboardingUnderstanding,
  );
  if (!agent) throw new Error('Onboarding Understanding agent is unavailable');

  const { context, registry } = materializeUnderstandingProviders(registrations, {
    db,
    userId,
  });
  const aiAgent = new AiAgentService(db, userId, {
    runtimeOptions: { snapshotStore: understandingSnapshotStore },
  });
  const runtimeCoordinator = new AgentRuntimeCoordinator();
  const messageModel = new MessageModel(db, userId);
  const topicModel = new TopicModel(db, userId);

  return new UnderstandingOrchestrator({
    agent: aiAgent,
    agentId: agent.id,
    context,
    ids: randomUUID,
    messages: {
      readContent: async (assistantMessageId) =>
        (await messageModel.findById(assistantMessageId))?.content,
    },
    operations: new AgentOperationModel(db, userId),
    registry,
    results: new UnderstandingResultRepository(db, userId),
    runtime: {
      deleteAgentOperation: runtimeCoordinator.deleteAgentOperation.bind(runtimeCoordinator),
    },
    sessions: new UnderstandingSessionRepository(db, userId),
    sourceStore: new UnderstandingSourceStore(),
    topic: {
      assertActiveOnboardingTopic: async (topicId) => {
        const topic = await topicModel.findById(topicId);
        const onboarding = topic?.metadata?.onboardingSession;
        if (!topic || !onboarding || onboarding.finishedAt) {
          throw new UnderstandingResourceNotFoundError('topic');
        }
      },
    },
  });
};
