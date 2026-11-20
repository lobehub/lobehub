import { TRPCError } from '@trpc/server';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentDocumentModel } from '@/database/models/agentDocuments';
import { TopicModel } from '@/database/models/topic';
import { TopicDocumentModel } from '@/database/models/topicDocument';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { createDocumentWorkRegistrar } from '@/server/services/agentDocuments/documentWork';
import { AgentDocumentVfsService } from '@/server/services/agentDocumentVfs';
import { AgentDocumentVfsError } from '@/server/services/agentDocumentVfs/errors';
import { SkillManagementDocumentService } from '@/server/services/skillManagement';
import { SystemAgentService } from '@/server/services/systemAgent';

const agentDocumentVfsErrorToTRPCCode = (
  code: AgentDocumentVfsError['code'],
): 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'METHOD_NOT_SUPPORTED' | 'NOT_FOUND' => {
  switch (code) {
    case 'CONFLICT': {
      return 'CONFLICT';
    }
    case 'FORBIDDEN': {
      return 'FORBIDDEN';
    }
    case 'METHOD_NOT_SUPPORTED': {
      return 'METHOD_NOT_SUPPORTED';
    }
    case 'NOT_FOUND': {
      return 'NOT_FOUND';
    }
    default: {
      return 'BAD_REQUEST';
    }
  }
};

export const handleAgentDocumentVfsError = (error: unknown): never => {
  if (error instanceof TRPCError) {
    throw error;
  }

  if (error instanceof AgentDocumentVfsError) {
    throw new TRPCError({
      cause: error,
      code: agentDocumentVfsErrorToTRPCCode(error.code),
      message: error.message,
    });
  }

  throw error;
};

export const agentDocumentProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentDocumentModel: new AgentDocumentModel(ctx.serverDB, ctx.userId, wsId),
      agentDocumentService: new AgentDocumentsService(ctx.serverDB, ctx.userId, wsId),
      agentDocumentVfsService: new AgentDocumentVfsService(ctx.serverDB, ctx.userId, wsId),
      skillManagementService: new SkillManagementDocumentService(ctx.serverDB, ctx.userId, wsId),
      systemAgentService: new SystemAgentService(ctx.serverDB, ctx.userId, wsId),
      documentWorkRegistrar: createDocumentWorkRegistrar({
        db: ctx.serverDB,
        logPrefix: '[agentDocumentRouter]',
        userId: ctx.userId,
        workspaceId: wsId,
      }),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId, wsId),
      topicDocumentModel: new TopicDocumentModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

// Write variant gates viewers out of every agent-document mutation
// (upsert/delete/rename/copy/skill-edit, plus the VFS path-based writes).
// Read endpoints keep using `agentDocumentProcedure`.
export const agentDocumentProcedureWrite = agentDocumentProcedure.use(
  withScopedPermission('document:update'),
);
