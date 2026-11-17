import { CONTACT_REQUEST_MESSAGE_MAX_LENGTH } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { ContactModel } from '@/database/models/contact';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { isChannelEnabled } from '@/server/services/channel/featureGate';
import { notifyContactRequestAfterResponse } from '@/server/services/contact/notify';

/**
 * The address book belongs to the Channel experience: contacts are who you can message there.
 * Everything in it belongs to the active scope. People: personal contacts in the personal space;
 * in a workspace, its external contacts (colleagues are its members). Shared Agents: the caller's
 * own in the personal space, the workspace's — seen by every member — in a workspace.
 */
const contactProcedure = wsCompatProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  if (!(await isChannelEnabled(ctx.userId)))
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Channels are not enabled for this account',
    });
  return next({
    ctx: { contactModel: new ContactModel(ctx.serverDB, ctx.userId, ctx.workspaceId) },
  });
});

const userId = z.string().min(1).max(64);
const requestId = z.string().uuid();
/** A username, `@handle`, share id or pasted share link. */
const handle = z.string().trim().min(1).max(512);

export const contactRouter = router({
  list: contactProcedure.query(async ({ ctx }) => ctx.contactModel.list()),

  search: contactProcedure
    .input(z.object({ query: handle }))
    .query(async ({ ctx, input }) => ctx.contactModel.search(input.query)),

  // ── People ────────────────────────────────────────────────────────────

  listRequests: contactProcedure.query(async ({ ctx }) => ctx.contactModel.listRequests()),

  // In a workspace this invites someone outside it to be an external contact: a member's act.
  sendRequest: contactProcedure
    .use(requireWorkspaceRoleWhenScoped('member'))
    .input(
      z.object({
        message: z.string().max(CONTACT_REQUEST_MESSAGE_MAX_LENGTH).optional(),
        userId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.contactModel.sendRequest(input.userId, input.message);
      // Sending while their request is pending accepts theirs, so they hear it was accepted.
      notifyContactRequestAfterResponse({
        actorUserId: ctx.userId,
        kind: result.status === 'accepted' ? 'accepted' : 'received',
        recipientUserId: input.userId,
        requestId: result.requestId,
      });
      return result;
    }),

  acceptRequest: contactProcedure
    .input(z.object({ requestId }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.contactModel.acceptRequest(input.requestId);
      notifyContactRequestAfterResponse({
        actorUserId: ctx.userId,
        kind: 'accepted',
        recipientUserId: result.contactUserId,
        requestId: input.requestId,
      });
      return result;
    }),

  declineRequest: contactProcedure
    .input(z.object({ requestId }))
    .mutation(async ({ ctx, input }) => {
      await ctx.contactModel.declineRequest(input.requestId);
      return { success: true };
    }),

  cancelRequest: contactProcedure
    .input(z.object({ requestId }))
    .mutation(async ({ ctx, input }) => {
      await ctx.contactModel.cancelRequest(input.requestId);
      return { success: true };
    }),

  removeUser: contactProcedure.input(z.object({ userId })).mutation(async ({ ctx, input }) => {
    await ctx.contactModel.removeUser(input.userId);
    return { success: true };
  }),

  /** A member opens themselves to one of the workspace's external contacts. */
  openToExternal: contactProcedure
    .use(requireWorkspaceRoleWhenScoped('member'))
    .input(z.object({ userId }))
    .mutation(async ({ ctx, input }) => {
      await ctx.contactModel.openTo(input.userId);
      return { success: true };
    }),

  /** An owner or admin removes an external contact from the workspace. */
  removeExternal: contactProcedure
    .use(requireWorkspaceRoleWhenScoped('admin'))
    .input(z.object({ userId }))
    .mutation(async ({ ctx, input }) => {
      await ctx.contactModel.removeExternal(input.userId);
      return { success: true };
    }),

  /** A person's profile, their relation to me and the Agents they share by link. */
  userProfile: contactProcedure.input(z.object({ userId })).query(async ({ ctx, input }) => {
    const [user, relation, sharedAgents] = await Promise.all([
      ctx.contactModel.findUser(input.userId),
      ctx.contactModel.relationTo(input.userId),
      ctx.contactModel.listSharedAgentsOf(input.userId),
    ]);
    if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    return { relation, sharedAgents, user };
  }),

  // ── Agents ────────────────────────────────────────────────────────────

  // Changing a workspace's address book takes a member; a viewer only reads it.
  addAgent: contactProcedure
    .use(requireWorkspaceRoleWhenScoped('member'))
    .input(z.object({ share: handle }))
    .mutation(async ({ ctx, input }) => ctx.contactModel.addAgent(input.share)),

  removeAgent: contactProcedure
    .use(requireWorkspaceRoleWhenScoped('member'))
    .input(z.object({ agentId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.contactModel.removeAgent(input.agentId);
      return { success: true };
    }),
});
