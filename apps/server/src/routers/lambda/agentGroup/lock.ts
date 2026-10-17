import { z } from 'zod';

import { publishResourceEvent } from '@/server/services/resourceEvents';

import { agentGroupProcedureWrite } from './procedures';

export const lockProcedures = {
  acquireGroupLock: agentGroupProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) return { expiresAt: null, holderId: null, lockedByOther: false };
      const prev = await ctx.editLockService.getActiveHolder('chatGroup', input.id);
      const result = await ctx.editLockService.acquire('chatGroup', input.id);
      if ((result.holderId ?? null) !== (prev ?? null)) {
        void publishResourceEvent(
          { id: input.id, type: 'chatGroup' },
          { actorId: ctx.userId, data: { holderId: result.holderId }, type: 'lock.changed' },
        );
      }
      return result;
    }),
  getGroupLock: agentGroupProcedureWrite
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.workspaceId) return { expiresAt: null, holderId: null, lockedByOther: false };
      const holder = await ctx.editLockService.getActiveHolder('chatGroup', input.id);
      return {
        expiresAt: null,
        holderId: holder ?? null,
        lockedByOther: Boolean(holder) && holder !== ctx.userId,
      };
    }),
  releaseGroupLock: agentGroupProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) return;
      // Only broadcast "unlocked" when we actually released our own lock — if the
      // lease expired and another member took over, the lock is still held.
      const released = await ctx.editLockService.release('chatGroup', input.id);
      if (!released) return;
      void publishResourceEvent(
        { id: input.id, type: 'chatGroup' },
        { actorId: ctx.userId, data: { holderId: null }, type: 'lock.changed' },
      );
    }),
};
