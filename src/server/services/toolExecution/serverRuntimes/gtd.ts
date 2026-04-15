import { GTDIdentifier } from '@lobechat/builtin-tool-gtd';
import {
  GTDExecutionRuntime,
  type GTDRuntimeService,
  type PlanDocument,
} from '@lobechat/builtin-tool-gtd/executionRuntime';
import { type LobeChatDatabase } from '@lobechat/database';

import { DocumentModel } from '@/database/models/document';
import { TopicDocumentModel } from '@/database/models/topicDocument';

import { type ServerRuntimeRegistration } from './types';

const PLAN_FILE_TYPE = 'agent/plan';

const createGTDRuntimeService = (serverDB: LobeChatDatabase, userId: string): GTDRuntimeService => {
  const documentModel = new DocumentModel(serverDB, userId);
  const topicDocumentModel = new TopicDocumentModel(serverDB, userId);

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
        fileType: PLAN_FILE_TYPE,
        source: `gtd:${topicId}`,
        sourceType: 'api',
        title: goal,
        totalCharCount: content.length,
        totalLineCount: content.split('\n').length,
      });

      await topicDocumentModel.associate({ documentId: doc.id, topicId });

      return toPlanDocument(doc);
    },

    findPlanById: async (id) => {
      const doc = await documentModel.findById(id);
      if (!doc || doc.fileType !== PLAN_FILE_TYPE) return null;
      return toPlanDocument(doc);
    },

    findPlanByTopic: async (topicId) => {
      const docs = await topicDocumentModel.findByTopicId(topicId, { type: PLAN_FILE_TYPE });
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

export const gtdRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for GTD tool execution');
    }

    const service = createGTDRuntimeService(context.serverDB, context.userId);
    return new GTDExecutionRuntime(service);
  },
  identifier: GTDIdentifier,
};
