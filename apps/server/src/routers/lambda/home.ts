import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { HomeRepository } from '@/database/repositories/home';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { createFtsSearchRepo } from '@/server/services/ftsSearch';
import { type HomeBriefData, HomeService } from '@/server/services/home';
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';

const homeProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentModel: new AgentModel(ctx.serverDB, ctx.userId, workspaceId),
      homeRepository: new HomeRepository(ctx.serverDB, ctx.userId, workspaceId),
      homeService: new HomeService(ctx.userId),
    },
  });
});

const homeSearchProcedure = homeProcedure.use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;
  const ftsSearchRepo = await createFtsSearchRepo({
    db: ctx.serverDB,
    userId: ctx.userId,
    usage: 'home_search',
    workspaceId,
  });

  return opts.next({
    ctx: {
      homeRepository: new HomeRepository(ctx.serverDB, ctx.userId, workspaceId, ftsSearchRepo),
    },
  });
});

export const homeRouter = router({
  getDailyBrief: homeProcedure.query(({ ctx }): Promise<HomeBriefData> =>
    ctx.homeService.getDailyBrief(),
  ),

  getSidebarAgentList: homeProcedure.query(async ({ ctx }) => {
    // The sidebar payload carries applied label names and colors, so it has to
    // respect the same grant as the label registry itself — otherwise denying
    // `agent_label:read` only closes the front door. Personal scope has no
    // workspace roles, so it always includes them.
    const includeLabels = ctx.workspaceId
      ? await hasWorkspaceScopedPermission({
          action: 'AGENT_LABEL_READ',
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        })
      : true;

    // Same reasoning for folders: this payload carries every shared Category's
    // id, name and order, so denying `session_group:read` has to close this
    // door too. Omitted rather than rejected — the agent list itself is not
    // gated on it, and losing the whole sidebar over a folder grant would be
    // worse than losing the folders.
    const includeGroups = ctx.workspaceId
      ? await hasWorkspaceScopedPermission({
          action: 'SESSION_GROUP_READ',
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        })
      : true;

    return ctx.homeRepository.getSidebarAgentList(includeLabels, includeGroups);
  }),

  searchAgents: homeSearchProcedure
    .input(z.object({ keyword: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.homeRepository.searchAgents(input.keyword);
    }),

  updateAgentSessionGroupId: homeProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentId: z.string(),
        sessionGroupId: z.string().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.updateSessionGroupId(input.agentId, input.sessionGroupId);
    }),
});

export type HomeRouter = typeof homeRouter;
