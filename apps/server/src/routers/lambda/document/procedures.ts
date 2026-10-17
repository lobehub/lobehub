import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { ChunkModel } from '@/database/models/chunk';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { WorkModel } from '@/database/models/work';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DocumentService } from '@/server/services/document';

export const documentProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      chunkModel: new ChunkModel(ctx.serverDB, ctx.userId, wsId),
      documentModel: new DocumentModel(ctx.serverDB, ctx.userId, wsId),
      documentService: new DocumentService(ctx.serverDB, ctx.userId, wsId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId, wsId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId, wsId),
      operationModel: new AgentOperationModel(ctx.serverDB, ctx.userId, wsId),
      workModel: new WorkModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});
