import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { AgentModel } from '@/database/models/agent';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { authedProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

export const messengerProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      // The System Bot is a single shared bot; the workspace a conversation
      // runs in is derived from the *active agent*, not the ambient
      // `X-Workspace-Id` header. So the link model is identity-scoped (by
      // userId), and per-agent authorization happens in-handler via
      // `resolveAuthorizedAgentScope`.
      messengerLinkModel: new MessengerAccountLinkModel(ctx.serverDB, ctx.userId),
      // The bindable-agents scope is request-driven — the cascading scope
      // picker passes the workspace via input, not the ambient header — so
      // expose a workspace-parameterized AgentModel factory rather than a
      // single pre-scoped instance.
      getAgentModel: (workspaceId?: string | null) =>
        new AgentModel(ctx.serverDB, ctx.userId, workspaceId ?? undefined),
    },
  });
});

export const messengerWriteProcedure = messengerProcedure.use(withScopedPermission('agent:update'));
