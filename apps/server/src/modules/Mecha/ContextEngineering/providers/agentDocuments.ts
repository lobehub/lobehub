import type { AgentContextDocument } from '@lobechat/context-engine';

import { log } from '@/server/modules/AgentRuntime/executorHelpers';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { toAgentContextDocuments } from '@/utils/agentDocumentContextMapping';

import type { ServerContextFactInput } from './types';

/**
 * The agent's context documents. A share visitor run never sees the creator's
 * documents: `applyShareGateToAgentConfig` already blanks `agentConfig.files` /
 * `knowledgeBases`, but this source is fetched independently of agentConfig,
 * so it needs its own gate. Fail closed unconditionally: the share config has
 * no setting that could grant file access.
 */
export const resolveAgentDocumentFacts = async ({
  agentId,
  ctx,
  workspaceId,
}: ServerContextFactInput): Promise<AgentContextDocument[] | undefined> => {
  if (!agentId || !ctx.serverDB || !ctx.userId || ctx.agentShareVisitor) return undefined;
  try {
    const docs = await new AgentDocumentsService(
      ctx.serverDB,
      ctx.userId,
      workspaceId,
    ).getAgentContextDocuments(agentId);
    if (docs.length === 0) return undefined;
    const documents = toAgentContextDocuments(docs);
    log('Resolved %d agent documents for agent %s', documents.length, agentId);
    return documents;
  } catch (error) {
    log('Failed to resolve agent documents for agent %s: %O', agentId, error);
    return undefined;
  }
};
