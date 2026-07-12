import type { DocumentLoadRule } from '@lobechat/agent-templates';
import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';
import { AgentDocumentsExecutionRuntime } from '@lobechat/builtin-tool-agent-documents/executionRuntime';
import { eq } from 'drizzle-orm';

import { TaskModel } from '@/database/models/task';
import { tasks } from '@/database/schemas';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { createDocumentWorkRegistrar } from '@/server/services/agentDocuments/documentWork';
import { emitAgentDocumentToolOutcomeSafely } from '@/server/services/agentDocuments/toolOutcome';

import { type ServerRuntimeRegistration } from './types';

export const agentDocumentsRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Agent Documents execution');
    }

    const db = context.serverDB;
    const userId = context.userId;
    const service = new AgentDocumentsService(
      db,
      userId,
      context.workspaceId,
      context.agentVisibility,
    );
    const { taskId } = context;
    const workRegistrar = createDocumentWorkRegistrar({
      db,
      logPrefix: '[agentDocumentsRuntime]',
      userId,
      workspaceId: context.workspaceId,
    });
    const emitDocumentOutcome = async (input: {
      agentId?: string;
      agentDocumentId?: string;
      apiName: string;
      errorReason?: string;
      hintIsSkill?: boolean;
      relation?: string;
      status: 'failed' | 'succeeded';
      summary: string;
      toolAction: string;
    }) => {
      await emitAgentDocumentToolOutcomeSafely({
        agentDocumentId: input.agentDocumentId,
        agentId: input.agentId ?? context.agentId,
        apiName: input.apiName,
        errorReason: input.errorReason,
        hintIsSkill: input.hintIsSkill,
        messageId: context.messageId,
        operationId: context.operationId,
        relation: input.relation,
        status: input.status,
        summary: input.summary,
        taskId: context.taskId,
        toolAction: input.toolAction,
        toolCallId: context.toolCallId,
        topicId: context.topicId,
        userId,
      });
    };

    const withDocumentOutcome = async <T>(
      input: {
        agentId?: string;
        getAgentDocumentId?: (result: T) => string | undefined;
        apiName: string;
        hintIsSkill?: boolean;
        relation: string;
        summary: string;
        toolAction: string;
      },
      operation: () => Promise<T>,
    ) => {
      try {
        const result = await operation();
        await emitDocumentOutcome({
          agentId: input.agentId,
          agentDocumentId: input.getAgentDocumentId?.(result),
          apiName: input.apiName,
          hintIsSkill: input.hintIsSkill,
          relation: input.relation,
          status: 'succeeded',
          summary: input.summary,
          toolAction: input.toolAction,
        });
        return result;
      } catch (error) {
        await emitDocumentOutcome({
          agentId: input.agentId,
          apiName: input.apiName,
          errorReason: (error as Error).message,
          hintIsSkill: input.hintIsSkill,
          relation: input.relation,
          status: 'failed',
          summary: `${input.summary} failed.`,
          toolAction: input.toolAction,
        });
        throw error;
      }
    };

    const pinToTask = async <T extends { documentId?: string } | undefined>(doc: T): Promise<T> => {
      if (taskId && doc?.documentId) {
        // Prefer the workspaceId already threaded through the pipeline; fall
        // back to the owning task row for legacy callers.
        let wsId = context.workspaceId;
        if (!wsId) {
          const [row] = await db
            .select({ workspaceId: tasks.workspaceId })
            .from(tasks)
            .where(eq(tasks.id, taskId))
            .limit(1);
          wsId = row?.workspaceId ?? undefined;
        }
        const taskModel = new TaskModel(db, userId, wsId);
        await taskModel.pinDocument(taskId, doc.documentId, 'agent');
      }
      return doc;
    };

    // Emit a Work-registration intent instead of writing the version inline: the
    // agent runtime persists it ONCE, stamping the tool call's cumulative cost at
    // insert time (cost is known only after execution). The intent rides out on
    // the tool result via the executor's `onWorkRegistration` sink. The document
    // URL is still resolved here because the workspace-slug lookup lives in this
    // request's registrar.
    const registerDocumentWork = async (input: {
      agentDocumentId?: string;
      agentId: string;
      documentId?: string;
      role: 'created' | 'updated';
      source: string;
    }) => {
      if (!input.documentId) return;

      context.onWorkRegistration?.({
        action: 'register',
        document: {
          agentDocumentId: input.agentDocumentId,
          agentId: input.agentId,
          documentId: input.documentId,
          role: input.role,
          source: input.source,
          url: await workRegistrar.buildRegisteredDocumentUrl(input.agentId, input.documentId),
        },
        type: 'document',
      });
    };

    const deleteDocumentWork = async (input: {
      agentDocumentId?: string;
      agentId: string;
      documentId?: string;
    }) => {
      if (!input.documentId) return;

      context.onWorkRegistration?.({
        action: 'delete',
        document: {
          agentDocumentId: input.agentDocumentId,
          agentId: input.agentId,
          documentId: input.documentId,
        },
        type: 'document',
      });
    };

    return new AgentDocumentsExecutionRuntime(
      {
        copyDocument: async ({ agentId, id, newTitle }) => {
          const doc = await pinToTask(
            await withDocumentOutcome(
              {
                agentId,
                apiName: 'copyDocument',
                getAgentDocumentId: (result) => result?.id,
                relation: 'created',
                summary: 'Agent documents copied a document.',
                toolAction: 'copy',
              },
              () => service.copyDocumentById(id, newTitle, agentId),
            ),
          );
          await registerDocumentWork({
            agentDocumentId: doc?.id,
            agentId,
            documentId: doc?.documentId,
            role: 'created',
            source: 'copyDocument',
          });
          return doc;
        },
        createDocument: async ({ agentId, content, hintIsSkill, title }) => {
          const doc = await pinToTask(
            await withDocumentOutcome(
              {
                agentId,
                apiName: 'createDocument',
                getAgentDocumentId: (result) => result?.id,
                hintIsSkill,
                relation: 'created',
                summary: 'Agent documents created a document.',
                toolAction: 'create',
              },
              () => service.createDocument(agentId, title, content, { hintIsSkill }),
            ),
          );
          await registerDocumentWork({
            agentDocumentId: doc?.id,
            agentId,
            documentId: doc?.documentId,
            role: 'created',
            source: 'createDocument',
          });
          return doc;
        },
        createTopicDocument: async ({ agentId, content, hintIsSkill, title, topicId }) => {
          const doc = await pinToTask(
            await withDocumentOutcome(
              {
                agentId,
                apiName: 'createTopicDocument',
                getAgentDocumentId: (result) => result?.id,
                hintIsSkill,
                relation: 'created',
                summary: 'Agent documents created a topic document.',
                toolAction: 'create',
              },
              () => service.createForTopic(agentId, title, content, topicId, { hintIsSkill }),
            ),
          );
          await registerDocumentWork({
            agentDocumentId: doc?.id,
            agentId,
            documentId: doc?.documentId,
            role: 'created',
            source: 'createTopicDocument',
          });
          return doc;
        },
        listDocuments: async ({ agentId, parentId, sourceType }) => {
          // Agents discover archived tool results via this path (see
          // `excludeArchivedToolResults`), so keep the `.tool-results` archive visible.
          const docs = await service.listDocuments(agentId, sourceType, {
            includeArchivedToolResults: true,
            parentId,
          });
          return docs.map((d) => ({
            documentId: d.documentId,
            filename: d.filename,
            id: d.id,
            title: d.title,
          }));
        },
        listTopicDocuments: async ({ agentId, parentId, sourceType, topicId }) => {
          const docs = await service.listDocumentsForTopic(agentId, topicId, sourceType, {
            includeArchivedToolResults: true,
          });
          // Topic listing joins through topic associations rather than the agent
          // folder tree, so the folder filter is applied in-memory here.
          const filtered = parentId ? docs.filter((d) => d.parentId === parentId) : docs;
          return filtered.map((d) => ({
            documentId: d.documentId,
            filename: d.filename,
            id: d.id,
            title: d.title,
          }));
        },
        modifyNodes: async ({ agentId, id, operations }) => {
          const doc = await withDocumentOutcome(
            {
              agentId,
              apiName: 'modifyNodes',
              getAgentDocumentId: () => id,
              relation: 'updated',
              summary: 'Agent documents modified document nodes.',
              toolAction: 'edit',
            },
            () => service.modifyDocumentNodesById(id, operations, agentId),
          );
          await registerDocumentWork({
            agentDocumentId: id,
            agentId,
            documentId: doc?.documentId,
            role: 'updated',
            source: 'modifyNodes',
          });
          return doc;
        },
        readDocument: ({ agentId, id }) => service.getDocumentSnapshotById(id, agentId),
        removeDocument: async ({ agentId, id }) => {
          const existing = await service.getDocumentById(id, agentId);
          const deleted = await withDocumentOutcome(
            {
              agentId,
              apiName: 'removeDocument',
              getAgentDocumentId: () => id,
              relation: 'removed',
              summary: 'Agent documents removed a document.',
              toolAction: 'remove',
            },
            () => service.removeDocumentById(id, agentId),
          );
          if (deleted) {
            await deleteDocumentWork({
              agentDocumentId: id,
              agentId,
              documentId: existing?.documentId,
            });
          }
          return deleted;
        },
        renameDocument: async ({ agentId, id, newTitle }) => {
          const doc = await withDocumentOutcome(
            {
              agentId,
              apiName: 'renameDocument',
              getAgentDocumentId: () => id,
              relation: 'updated',
              summary: 'Agent documents renamed a document.',
              toolAction: 'rename',
            },
            () => service.renameDocumentById(id, newTitle, agentId),
          );
          await registerDocumentWork({
            agentDocumentId: id,
            agentId,
            documentId: doc?.documentId,
            role: 'updated',
            source: 'renameDocument',
          });
          return doc;
        },
        replaceDocumentContent: async ({ agentId, content, id }) => {
          const doc = await withDocumentOutcome(
            {
              agentId,
              apiName: 'replaceDocumentContent',
              getAgentDocumentId: () => id,
              relation: 'updated',
              summary: 'Agent documents replaced document content.',
              toolAction: 'replace',
            },
            () => service.replaceDocumentContentById(id, content, agentId),
          );
          await registerDocumentWork({
            agentDocumentId: id,
            agentId,
            documentId: doc?.documentId,
            role: 'updated',
            source: 'replaceDocumentContent',
          });
          return doc;
        },
        updateLoadRule: ({ agentId, id, rule }) =>
          withDocumentOutcome(
            {
              agentId,
              apiName: 'updateLoadRule',
              getAgentDocumentId: () => id,
              relation: 'updated',
              summary: 'Agent documents updated a load rule.',
              toolAction: 'update',
            },
            () =>
              service.updateLoadRuleById(
                id,
                { ...rule, rule: rule.rule as DocumentLoadRule | undefined },
                agentId,
              ),
          ),
      },
      {
        getDocumentUrl: ({ agentId, documentId }) =>
          workRegistrar.buildRegisteredDocumentUrl(agentId, documentId),
      },
    );
  },
  identifier: AgentDocumentsIdentifier,
};
