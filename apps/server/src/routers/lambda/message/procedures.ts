import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { MessageModel } from '@/database/models/message';
import { CompressionRepository } from '@/database/repositories/compression';
import { TopicDoctorRepo } from '@/database/repositories/topicDoctor';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import { MessageService } from '@/server/services/message';

import type { assertCanUseMessageTargets } from '../_helpers/conversationResourceGuard';

/** Ctx slice consumed by the conversation General-access guards. */
export const guardCtx = (ctx: {
  serverDB: Parameters<typeof assertCanUseMessageTargets>[0]['db'];
  userId: string;
  workspaceId?: string | null;
}) => ({ db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId });

export const messageProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      compressionRepo: new CompressionRepository(ctx.serverDB, ctx.userId, wsId),
      fileService: new FileService(ctx.serverDB, ctx.userId, wsId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId, wsId),
      messageService: new MessageService(ctx.serverDB, ctx.userId, wsId),
      topicDoctorRepo: new TopicDoctorRepo(ctx.serverDB, ctx.userId, wsId),
    },
  });
});
