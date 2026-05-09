import type { DocumentLoadRule } from '@lobechat/agent-templates';
import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';
import { AgentDocumentsExecutionRuntime } from '@lobechat/builtin-tool-agent-documents/executionRuntime';

import { TaskModel } from '@/database/models/task';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { emitAgentDocumentToolOutcomeSafely } from '@/server/services/agentDocuments/toolOutcome';

import { type ServerRuntimeRegistration } from './types';

export const agentDocumentsRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Agent Documents execution');
    }

    const service = new AgentDocumentsService(context.serverDB, context.userId);
    const userId = context.userId;
    const taskModel = new TaskModel(context.serverDB, context.userId);
    const { taskId } = context;
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
        await taskModel.pinDocument(taskId, doc.documentId, 'agent');
      }
      return doc;
    };

    return new AgentDocumentsExecutionRuntime({
      copyDocument: async ({ agentId, id, newTitle }) =>
        pinToTask(
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
        ),
      createDocument: async ({ agentId, content, hintIsSkill, title }) =>
        pinToTask(
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
        ),
      createTopicDocument: async ({ agentId, content, hintIsSkill, title, topicId }) =>
        pinToTask(
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
        ),
      listDocuments: async ({ agentId }) => {
        const docs = await service.listDocuments(agentId);
        return docs.map((d) => ({
          documentId: d.documentId,
          filename: d.filename,
          id: d.id,
          title: d.title,
        }));
      },
      listTopicDocuments: async ({ agentId, topicId }) => {
        const docs = await service.listDocumentsForTopic(agentId, topicId);
        return docs.map((d) => ({
          documentId: d.documentId,
          filename: d.filename,
          id: d.id,
          title: d.title,
        }));
      },
      modifyNodes: ({ agentId, id, operations }) =>
        withDocumentOutcome(
          {
            agentId,
            apiName: 'modifyNodes',
            getAgentDocumentId: () => id,
            relation: 'updated',
            summary: 'Agent documents modified document nodes.',
            toolAction: 'edit',
          },
          () => service.modifyDocumentNodesById(id, operations, agentId),
        ),
      readDocument: ({ agentId, id }) => service.getDocumentSnapshotById(id, agentId),
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
          () => service.removeDocumentById(id, agentId),
        ),
      renameDocument: ({ agentId, id, newTitle }) =>
        withDocumentOutcome(
          {
            agentId,
            apiName: 'renameDocument',
            getAgentDocumentId: () => id,
            relation: 'updated',
            summary: 'Agent documents renamed a document.',
            toolAction: 'rename',
          },
          () => service.renameDocumentById(id, newTitle, agentId),
        ),
      replaceDocumentContent: ({ agentId, content, id }) =>
        withDocumentOutcome(
          {
            agentId,
            apiName: 'replaceDocumentContent',
            getAgentDocumentId: () => id,
            relation: 'updated',
            summary: 'Agent documents replaced document content.',
            toolAction: 'replace',
          },
          () => service.replaceDocumentContentById(id, content, agentId),
        ),
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
    });
  },
  identifier: AgentDocumentsIdentifier,
};
