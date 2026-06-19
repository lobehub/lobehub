import { count, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ApiKeyModel } from '@/database/models/apiKey';
import { agents, apiKeys, chatGroups, files, messages, sessions, topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import {
  assertWorkspaceMember,
  assertWorkspaceOwner,
  getWorkspaceControl,
  getWorkspaceSettings,
} from './_workspaceControl';

const dataProcedure = authedProcedure.use(serverDatabase);

type WorkspaceScopedTable =
  | typeof agents
  | typeof apiKeys
  | typeof chatGroups
  | typeof files
  | typeof messages
  | typeof sessions
  | typeof topics;

const countByWorkspace = async (
  ctx: { serverDB: LobeChatDatabase },
  table: WorkspaceScopedTable,
  workspaceId: string,
) => {
  const [row] = await ctx.serverDB
    .select({ count: count() })
    .from(table)
    .where(eq(table.workspaceId, workspaceId));

  return row?.count ?? 0;
};

export const workspaceDataRouter = router({
  clearApiKeys: dataProcedure
    .input(z.object({ workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceOwner(ctx, input.workspaceId);
      await new ApiKeyModel(ctx.serverDB, ctx.userId, input.workspaceId).deleteAll();
    }),

  exportSummary: dataProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId);
      const { memberModel, workspaceModel } = getWorkspaceControl(ctx);
      const workspace = await workspaceModel.findById(input.workspaceId);
      const members = await memberModel.listMembers(input.workspaceId);
      const settings = await getWorkspaceSettings(ctx, input.workspaceId);

      return {
        exportedAt: new Date().toISOString(),
        members,
        settings,
        stats: {
          agentGroups: await countByWorkspace(ctx, chatGroups, input.workspaceId),
          agents: await countByWorkspace(ctx, agents, input.workspaceId),
          apiKeys: await countByWorkspace(ctx, apiKeys, input.workspaceId),
          files: await countByWorkspace(ctx, files, input.workspaceId),
          messages: await countByWorkspace(ctx, messages, input.workspaceId),
          sessions: await countByWorkspace(ctx, sessions, input.workspaceId),
          topics: await countByWorkspace(ctx, topics, input.workspaceId),
        },
        workspace,
      };
    }),
});
