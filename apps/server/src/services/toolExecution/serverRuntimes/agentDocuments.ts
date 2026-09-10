import type { DocumentLoadRule } from '@lobechat/agent-templates';
import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';
import { AgentDocumentsExecutionRuntime } from '@lobechat/builtin-tool-agent-documents/executionRuntime';
import { agentShareDocumentAccessScope, ordinaryDocumentAccessScope } from '@lobechat/types';

import { TaskModel } from '@/database/models/task';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { createDocumentWorkRegistrar } from '@/server/services/agentDocuments/documentWork';
import { emitAgentDocumentToolOutcomeSafely } from '@/server/services/agentDocuments/toolOutcome';

import { resolveTaskWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';

export const agentDocumentsRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Agent Documents execution');
    }

    const db = context.serverDB;
    const userId = context.userId;
    if (context.agentShareVisitor && !context.topicId) {
      throw new Error('topicId is required for Agent Share document execution');
    }

    const shareTopicId = context.agentShareVisitor ? context.topicId : undefined;
    const documentAccessScope = context.agentShareVisitor
      ? agentShareDocumentAccessScope({
          shareId: context.agentShareVisitor.shareId,
          topicId: shareTopicId!,
          visitorUserId: context.agentShareVisitor.visitorUserId,
        })
      : ordinaryDocumentAccessScope;
    const { taskId } = context;
    // Resolve and validate the task-derived scope once, before any document
    // read or write. Even when the pipeline supplied workspaceId, a task that
    // was trashed after dispatch or belongs to another scope must fail closed.
    let workspaceIdPromise: Promise<string | undefined> | undefined;
    const resolveWorkspaceId = () =>
      (workspaceIdPromise ??= resolveTaskWorkspaceId(db, taskId, context.workspaceId));
    let servicePromise: Promise<AgentDocumentsService> | undefined;
    const getService = () =>
      (servicePromise ??= resolveWorkspaceId().then(
        (workspaceId) =>
          new AgentDocumentsService(
            db,
            userId,
            workspaceId,
            context.agentVisibility,
            documentAccessScope,
          ),
      ));
    let workRegistrarPromise: Promise<ReturnType<typeof createDocumentWorkRegistrar>> | undefined;
    const getWorkRegistrar = () =>
      (workRegistrarPromise ??= resolveWorkspaceId().then((workspaceId) =>
        createDocumentWorkRegistrar({
          db,
          logPrefix: '[agentDocumentsRuntime]',
          userId,
          workspaceId,
        }),
      ));
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
        const taskModel = new TaskModel(db, userId, await resolveWorkspaceId());
        await taskModel.pinDocument(taskId, doc.documentId, 'agent');
      }
      return doc;
    };

    // Work registration is now manifest-driven: each mutating API declares a
    // `work` config in the agent-documents manifest and stamps a uniform identity
    // block into its result `state`. The tool-execution dispatch layer resolves
    // the Work intent from that config + state (see `resolveBuiltinToolWorkIntent`
    // / `stashBuiltinToolWorkIntent`), so this runtime no longer emits intents
    // imperatively via `context.onWorkRegistration`.

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
              async () => (await getService()).copyDocumentById(id, newTitle, agentId),
            ),
          );
          return doc;
        },
        createDocument: async ({ agentId, content, hintIsSkill, parentId, title }) => {
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
              async () => {
                const service = await getService();
                return shareTopicId
                  ? service.createForTopic(agentId, title, content, shareTopicId)
                  : service.createDocument(agentId, title, content, { hintIsSkill, parentId });
              },
            ),
          );
          return doc;
        },
        createTopicDocument: async ({
          agentId,
          content,
          hintIsSkill,
          parentId,
          title,
          topicId,
        }) => {
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
              async () =>
                (await getService()).createForTopic(
                  agentId,
                  title,
                  content,
                  shareTopicId ?? topicId,
                  shareTopicId ? undefined : { hintIsSkill, parentId },
                ),
            ),
          );
          return doc;
        },
        listDocuments: async ({ agentId, parentId, sourceType }) => {
          const service = await getService();
          // Agents discover archived tool results via this path (see
          // `excludeArchivedToolResults`), so keep the `.tool-results` archive visible.
          const docs = shareTopicId
            ? await service.listDocumentsForTopic(agentId, shareTopicId, sourceType, {
                includeArchivedToolResults: true,
              })
            : await service.listDocuments(agentId, sourceType, {
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
          const service = await getService();
          const docs = await service.listDocumentsForTopic(
            agentId,
            shareTopicId ?? topicId,
            sourceType,
            {
              includeArchivedToolResults: true,
            },
          );
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
            async () => (await getService()).modifyDocumentNodesById(id, operations, agentId),
          );
          return doc;
        },
        readDocument: async ({ agentId, id }) =>
          (await getService()).getDocumentSnapshotById(id, agentId),
        removeDocument: ({ agentId, id }) =>
          withDocumentOutcome(
            {
              agentId,
              apiName: 'removeDocument',
              getAgentDocumentId: () => id,
              relation: 'removed',
              summary: 'Agent documents removed a document.',
              toolAction: 'remove',
            },
            async () => (await getService()).removeDocumentById(id, agentId),
          ),
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
            async () => (await getService()).renameDocumentById(id, newTitle, agentId),
          );
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
            async () => (await getService()).replaceDocumentContentById(id, content, agentId),
          );
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
            async () =>
              (await getService()).updateLoadRuleById(
                id,
                { ...rule, rule: rule.rule as DocumentLoadRule | undefined },
                agentId,
              ),
          ),
      },
      {
        documentReadonly: Boolean(context.agentShareVisitor),
        getDocumentUrl: context.agentShareVisitor
          ? undefined
          : async ({ agentId, documentId }) =>
              (await getWorkRegistrar()).buildRegisteredDocumentUrl(agentId, documentId),
      },
    );
  },
  identifier: AgentDocumentsIdentifier,
};
