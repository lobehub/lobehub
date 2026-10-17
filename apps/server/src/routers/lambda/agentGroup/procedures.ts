import { AgentPluginEntrySchema } from '@lobechat/types';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { UserModel } from '@/database/models/user';
import { AgentGroupRepository } from '@/database/repositories/agentGroup';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentGroupService } from '@/server/services/agentGroup';
import { EditLockService } from '@/server/services/editLock';

export const agentGroupProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentGroupRepo: new AgentGroupRepository(ctx.serverDB, ctx.userId, wsId),
      agentGroupService: new AgentGroupService(ctx.serverDB, ctx.userId, wsId),
      agentModel: new AgentModel(ctx.serverDB, ctx.userId, wsId),
      chatGroupModel: new ChatGroupModel(ctx.serverDB, ctx.userId, wsId),
      editLockService: new EditLockService(ctx.userId),
      userModel: new UserModel(ctx.serverDB, ctx.userId),
    },
  });
});

// Write variant gates viewers out of chat-group mutations (create/update/
// delete + member adds/removes). Reads keep the bare proc.
export const agentGroupProcedureWrite = agentGroupProcedure.use(
  withScopedPermission('agent:update'),
);

/**
 * Custom schema for agent member input, replacing drizzle-generated insertAgentSchema
 * to avoid Json type inference issues with jsonb columns.
 */
export const agentMemberInputSchema = z
  .object({
    agencyConfig: z.any().nullish(),
    avatar: z.string().nullish(),
    backgroundColor: z.string().nullish(),
    clientId: z.string().nullish(),
    description: z.string().nullish(),
    editorData: z.any().nullish(),
    fewShots: z.any().nullish(),
    id: z.string().optional(),
    marketIdentifier: z.string().nullish(),
    model: z.string().nullish(),
    params: z.any().nullish(),
    pinned: z.boolean().nullish(),
    plugins: z.array(AgentPluginEntrySchema).nullish(),
    provider: z.string().nullish(),
    sessionGroupId: z.string().nullish(),
    slug: z.string().nullish(),
    systemRole: z.string().nullish(),
    tags: z.array(z.string()).nullish(),
    title: z.string().nullish(),
    virtual: z.boolean().nullish(),
  })
  .partial();
