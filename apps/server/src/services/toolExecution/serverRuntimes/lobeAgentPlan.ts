import { type PlanDocument, type PlanRuntimeService } from '@lobechat/builtin-tool-lobe-agent';
import { AGENT_PLAN_FILE_TYPE } from '@lobechat/const';
import { type LobeChatDatabase } from '@lobechat/database';

import { DocumentModel } from '@/database/models/document';
import { TopicDocumentModel } from '@/database/models/topicDocument';

/**
 * Build a server-side `PlanRuntimeService` backed by the application database.
 *
 * The factory is consumed by `lobeAgent.ts`'s `LobeAgentExecutionRuntime`,
 * which folds plan/todo execution into the lobe-agent server runtime so the
 * registry has a single runtime per identifier.
 */
export const createServerPlanRuntimeService = (
  serverDB: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
  callerAgentVisibility?: 'private' | 'public' | null,
  /**
   * Share-visitor scoping (Codex P1, `lobe-agent`'s `updatePlan`): when set,
   * `findPlanById` only resolves a plan document that is actually associated
   * with THIS topic, via `topicDocumentModel.isAssociated`.
   *
   * `updatePlan` takes `planId` straight from the model's tool-call
   * arguments and, without this guard, resolves it purely by creator
   * ownership (`DocumentModel.findById`'s `ownership()` checks `userId` /
   * `workspaceId`, not which topic created the document). A share visitor's
   * run always executes under the CREATOR's DB credentials
   * (`AgentShareGate.visitorUserId` only labels who is driving it — see
   * `shareGate.ts`), so a visitor who supplies any other `docs_xxx` plan id
   * owned by the creator — from a different topic, or a different shared
   * agent entirely — could read it back and, via the immediately following
   * `service.updatePlan` call, silently overwrite its goal/description/
   * content. `shareGate.ts` cannot enforce this itself: unlike the static
   * `knowledgeBaseIds` allowlist, a topic's plan id is often created mid-run
   * (`createPlan`) and has no DB access from that module to verify
   * membership. Enforcing it here, at the one place that already resolves
   * `planId` against the database, is the fail-closed equivalent — see
   * `apps/server/src/services/toolExecution/serverRuntimes/lobeAgent.ts`,
   * which threads this from `ToolExecutionContext.agentShare`/`topicId`.
   *
   * `undefined` (the default) means "no restriction" — used for ordinary,
   * non-share runs, where a plan may legitimately be looked up by id outside
   * the topic that originally created it.
   */
  restrictToTopicId?: string,
): PlanRuntimeService => {
  const documentModel = new DocumentModel(serverDB, userId, workspaceId, callerAgentVisibility);
  const topicDocumentModel = new TopicDocumentModel(serverDB, userId, workspaceId);

  const toPlanDocument = (doc: {
    content: string | null;
    createdAt: Date;
    description: string | null;
    id: string;
    metadata: Record<string, any> | null;
    title: string | null;
    updatedAt: Date;
  }): PlanDocument => ({
    content: doc.content,
    createdAt: doc.createdAt,
    description: doc.description,
    id: doc.id,
    metadata: doc.metadata,
    title: doc.title,
    updatedAt: doc.updatedAt,
  });

  const loadPlanOrThrow = async (id: string) => {
    const doc = await documentModel.findById(id);
    if (!doc) throw new Error(`Plan not found after update: ${id}`);
    return toPlanDocument(doc);
  };

  return {
    createPlan: async ({ topicId, goal, description, content }) => {
      const doc = await documentModel.create({
        content,
        description,
        fileType: AGENT_PLAN_FILE_TYPE,
        source: `lobe-agent:${topicId}`,
        sourceType: 'api',
        title: goal,
        totalCharCount: content.length,
        totalLineCount: content.split('\n').length,
        // Private-agent plans stay in the owner's private Pages; public
        // agents' plans stay visible to the workspace. When null (no agent
        // context resolvable), fall through to `DocumentModel.create`'s
        // existing `sourceType='api'` fallback (→ private in workspace mode).
        ...(callerAgentVisibility === 'private' || callerAgentVisibility === 'public'
          ? { visibility: callerAgentVisibility }
          : {}),
      });

      await topicDocumentModel.associate({ documentId: doc.id, topicId });

      return toPlanDocument(doc);
    },

    findPlanById: async (id) => {
      const doc = await documentModel.findById(id);
      if (!doc || doc.fileType !== AGENT_PLAN_FILE_TYPE) return null;

      // Fail closed: an id that isn't associated with the restricted topic
      // is treated exactly like "not found" — see `restrictToTopicId` above.
      if (
        restrictToTopicId !== undefined &&
        !(await topicDocumentModel.isAssociated(id, restrictToTopicId))
      ) {
        return null;
      }

      return toPlanDocument(doc);
    },

    findPlanByTopic: async (topicId) => {
      const docs = await topicDocumentModel.findByTopicId(topicId, { type: AGENT_PLAN_FILE_TYPE });
      const first = docs[0];
      return first ? toPlanDocument(first) : null;
    },

    updatePlan: async (id, { goal, description, content }) => {
      const updateData: Record<string, any> = {};
      if (goal !== undefined) updateData.title = goal;
      if (description !== undefined) updateData.description = description;
      if (content !== undefined) {
        updateData.content = content;
        updateData.totalCharCount = content.length;
        updateData.totalLineCount = content.split('\n').length;
      }

      if (Object.keys(updateData).length > 0) {
        await documentModel.update(id, updateData);
      }

      return loadPlanOrThrow(id);
    },

    updatePlanMetadata: async (id, metadata) => {
      await documentModel.update(id, { metadata });
    },
  };
};
