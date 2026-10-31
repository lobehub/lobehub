import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { TopicShareModel } from '@/database/models/topicShare';
import { AgentMigrationRepo } from '@/database/repositories/agentMigration';
import { HeteroSessionImporterRepo } from '@/database/repositories/heteroSessionImporter';
import { TopicRepository } from '@/database/repositories/topic';
import { TopicImporterRepo } from '@/database/repositories/topicImporter';
import type { LobeChatDatabase } from '@/database/type';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { createFtsSearchRepo } from '@/server/services/ftsSearch';
import { TrashService } from '@/server/services/trash';

/** Ctx slice consumed by the conversation General-access guards. */
export const guardCtx = (ctx: {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}) => ({ db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId });

export const topicProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentMigrationRepo: new AgentMigrationRepo(ctx.serverDB, ctx.userId, wsId),
      agentModel: new AgentModel(ctx.serverDB, ctx.userId, wsId),
      agentOperationModel: new AgentOperationModel(ctx.serverDB, ctx.userId, wsId),
      chatGroupModel: new ChatGroupModel(ctx.serverDB, ctx.userId, wsId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId, wsId),
      heteroSessionImporterRepo: new HeteroSessionImporterRepo(ctx.serverDB, ctx.userId, wsId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId, wsId),
      topicImporterRepo: new TopicImporterRepo(ctx.serverDB, ctx.userId, wsId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId, wsId),
      topicRepo: new TopicRepository(ctx.serverDB, ctx.userId, wsId),
      topicShareModel: new TopicShareModel(ctx.serverDB, ctx.userId, wsId),
      trashService: new TrashService(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

export const topicSearchProcedure = topicProcedure.use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;
  const ftsSearchRepo = await createFtsSearchRepo({
    db: ctx.serverDB,
    userId: ctx.userId,
    usage: 'topic_search',
    workspaceId,
  });

  return opts.next({
    ctx: {
      topicModel: new TopicModel(ctx.serverDB, ctx.userId, workspaceId, ftsSearchRepo),
    },
  });
});
