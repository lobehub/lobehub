import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { publishResourceEvent } from '@/server/services/resourceEvents';

import { agentProcedure } from './procedures';

export const editLockProcedures = {
  acquireAgentLock: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) return { expiresAt: null, holderId: null, lockedByOther: false };
      const prev = await ctx.editLockService.getActiveHolder('agent', input.agentId);
      const result = await ctx.editLockService.acquire('agent', input.agentId);
      if ((result.holderId ?? null) !== (prev ?? null)) {
        void publishResourceEvent(
          { id: input.agentId, type: 'agent' },
          { actorId: ctx.userId, data: { holderId: result.holderId }, type: 'lock.changed' },
        );
      }
      return result;
    }),
  getAgentLock: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(z.object({ agentId: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.workspaceId) return { expiresAt: null, holderId: null, lockedByOther: false };
      const holder = await ctx.editLockService.getActiveHolder('agent', input.agentId);
      return {
        expiresAt: null,
        holderId: holder ?? null,
        lockedByOther: Boolean(holder) && holder !== ctx.userId,
      };
    }),
  releaseAgentLock: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) return;
      // Only broadcast "unlocked" when we actually released our own lock — if the
      // lease expired and another member took over, the lock is still held.
      const released = await ctx.editLockService.release('agent', input.agentId);
      if (!released) return;
      void publishResourceEvent(
        { id: input.agentId, type: 'agent' },
        { actorId: ctx.userId, data: { holderId: null }, type: 'lock.changed' },
      );
    }),
};
