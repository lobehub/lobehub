import type { AgentAvailability } from '@lobechat/types';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentAvailabilityService } from '@/server/services/agentAvailability';

const availabilityProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      availabilityService: new AgentAvailabilityService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

export const agentAvailabilityRouter = router({
  /**
   * Whether each agent can take work right now, in one read: its status, the queued and
   * running Channel replies it has, when an off-duty agent's quota comes back, and whether
   * routing may hand it an unaddressed message. Agents the caller cannot see are absent.
   */
  getAvailability: availabilityProcedure
    .input(z.object({ agentIds: z.array(z.string()).max(200) }))
    .query(async ({ ctx, input }): Promise<Record<string, AgentAvailability>> =>
      ctx.availabilityService.getAvailability(input.agentIds),
    ),
});
