import {
  AGENT_SIGNAL_REVIEW_IDENTIFIER,
  AGENT_SIGNAL_REVIEW_TOOL_API_NAMES,
  AgentSignalToolExecutionRuntime,
} from '@lobechat/builtin-tool-agent-signal';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { BriefModel } from '@/database/models/brief';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { readAgentSignalMarker } from '@/server/services/agentSignal/operationMarker';
import { createServerSelfReviewBriefWriter } from '@/server/services/agentSignal/services/selfIteration/review/brief';
import { createReviewRuntimePrimitives } from '@/server/services/agentSignal/services/selfIteration/review/server';
import { SkillManagementDocumentService } from '@/server/services/skillManagement';
import { translation } from '@/server/translation';

import type { ServerRuntimeRegistration } from './types';

const resolveBriefTextTranslator = async (db: LobeChatDatabase, userId: string) => {
  const userInfo = await UserModel.getInfoForAIGeneration(db, userId);
  const { t } = await translation('home', userInfo.responseLanguage ?? 'en-US');

  return t;
};

/**
 * Registers the nightly-review self-iteration builtin server runtime, so an
 * `execAgent` run with `plugins: ['agent-signal-review']` can execute its tools.
 *
 * The factory resolves the review window from the operation's `agentSignal`
 * marker (the only per-run state a tool still needs — the evidence corpus is in
 * the agent's prompt), builds the pure live-DB primitives from the execution
 * context, and hands them to the package runtime. No evidence collector, no
 * `createServerToolSet` side channel (dedupe / receipt / operation state).
 */
export const agentSignalReviewRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    const { agentId, operationId, serverDB, userId } = context;
    if (!agentId || !userId || !operationId || !serverDB) {
      throw new Error('agent-signal-review requires agentId, userId, operationId and serverDB');
    }

    const operation = await new AgentOperationModel(serverDB, userId).findById(operationId);
    const marker = readAgentSignalMarker(operation?.metadata);

    const reviewWindowEnd = marker?.reviewWindowEnd ?? new Date(0).toISOString();
    const reviewWindowStart = marker?.reviewWindowStart ?? new Date(0).toISOString();
    const localDate = marker?.localDate ?? reviewWindowEnd.slice(0, 10);
    const sourceId = marker?.sourceId ?? operationId;

    const service = createReviewRuntimePrimitives({
      agentId,
      briefModel: new BriefModel(serverDB, userId),
      briefTextTranslator: await resolveBriefTextTranslator(serverDB, userId),
      db: serverDB,
      localDate,
      proposalBriefWriter: createServerSelfReviewBriefWriter(serverDB, userId),
      reviewWindowEnd,
      reviewWindowStart,
      skillDocumentService: new SkillManagementDocumentService(serverDB, userId),
      sourceId,
      userId,
    });

    return new AgentSignalToolExecutionRuntime({
      apiNames: AGENT_SIGNAL_REVIEW_TOOL_API_NAMES,
      service,
    });
  },
  identifier: AGENT_SIGNAL_REVIEW_IDENTIFIER,
};
