import { CONTACT_REQUEST_MESSAGE_MAX_LENGTH } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  denyExternalContact,
  requireWorkspaceRoleWhenScoped,
  wsExternalCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { ContactModel } from '@/database/models/contact';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { isChannelEnabled } from '@/server/services/channel/featureGate';
import { openContactConversation } from '@/server/services/contact/conversation';
import {
  notifyContactRequestAfterResponse,
  notifyContactsChangedAfterResponse,
} from '@/server/services/contact/notify';

/**
 * The address book belongs to the Channel experience: contacts are who you can message there.
 * Everything in it belongs to the active scope. People: personal contacts in the personal space;
 * in a workspace, its external contacts (colleagues are its members). Shared Agents: the caller's
 * own in the personal space, the workspace's — seen by every member — in a workspace.
 */
const contactBaseProcedure = wsExternalCompatProcedure
  .use(serverDatabase)
  .use(async ({ ctx, next }) => {
    if (!(await isChannelEnabled(ctx.userId)))
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Channels are not enabled for this account',
      });
    return next({
      ctx: { contactModel: new ContactModel(ctx.serverDB, ctx.userId, ctx.workspaceId) },
    });
  });

/**
 * What a workspace's external contact may read there: the members open to them, and dropping
 * one. `ContactModel` narrows each of these to them; requests are answered by id, from the
 * personal space.
 */
const externalContactProcedure = contactBaseProcedure;
/** Everything else is for members (and the personal space) only. */
const contactProcedure = contactBaseProcedure.use(denyExternalContact);

const userId = z.string().min(1).max(64);
const requestId = z.string().uuid();
/** A username, `@handle`, share id or pasted share link. */
const handle = z.string().trim().min(1).max(512);

export const contactRouter = router({
  list: externalContactProcedure.query(async ({ ctx }) => ctx.contactModel.list()),

  search: externalContactProcedure
    .input(z.object({ query: handle }))
    .query(async ({ ctx, input }) => ctx.contactModel.search(input.query)),

  // ── People ────────────────────────────────────────────────────────────

  /** The workspaces I am an external contact of, whatever the active scope. */
  listExternalWorkspaces: externalContactProcedure.query(async ({ ctx }) =>
    ctx.contactModel.listExternalWorkspaces(),
  ),

  listRequests: externalContactProcedure.query(async ({ ctx }) => ctx.contactModel.listRequests()),

  // In a workspace this invites someone outside it to be an external contact: a member's act.
  sendRequest: contactProcedure
    .use(requireWorkspaceRoleWhenScoped('member'))
    .input(
      z.object({
        /** The card message the person was found through, recorded as the request's source. */
        cardMessageId: z.uuid().optional(),
        message: z.string().max(CONTACT_REQUEST_MESSAGE_MAX_LENGTH).optional(),
        userId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.contactModel.sendRequest(input.userId, input.message, {
        cardMessageId: input.cardMessageId,
      });
      // Their pending request is the one answered: they asked, in the active scope.
      if (result.status === 'accepted')
        await openContactConversation({
          addresseeId: ctx.userId,
          db: ctx.serverDB,
          requesterId: input.userId,
          workspaceId: ctx.workspaceId ?? null,
        });
      // Sending while their request is pending accepts theirs, so they hear it was accepted.
      notifyContactRequestAfterResponse({
        actorUserId: ctx.userId,
        kind: result.status === 'accepted' ? 'accepted' : 'received',
        recipientUserId: input.userId,
        requestId: result.requestId,
      });
      notifyContactsChangedAfterResponse([ctx.userId, input.userId]);
      return result;
    }),

  acceptRequest: externalContactProcedure
    .input(z.object({ requestId }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.contactModel.acceptRequest(input.requestId);
      // Opened by the requester in the request's scope: in a workspace that is the member who
      // invited, while the caller answers from the personal space.
      await openContactConversation({
        addresseeId: ctx.userId,
        db: ctx.serverDB,
        requesterId: result.contactUserId,
        workspaceId: result.workspaceId,
      });
      notifyContactRequestAfterResponse({
        actorUserId: ctx.userId,
        kind: 'accepted',
        recipientUserId: result.contactUserId,
        requestId: input.requestId,
      });
      notifyContactsChangedAfterResponse([ctx.userId, result.contactUserId]);
      return result;
    }),

  declineRequest: externalContactProcedure
    .input(z.object({ requestId }))
    .mutation(async ({ ctx, input }) => {
      const { requesterId } = await ctx.contactModel.declineRequest(input.requestId);
      notifyContactsChangedAfterResponse([ctx.userId, requesterId]);
      return { success: true };
    }),

  cancelRequest: externalContactProcedure
    .input(z.object({ requestId }))
    .mutation(async ({ ctx, input }) => {
      const { addresseeId } = await ctx.contactModel.cancelRequest(input.requestId);
      notifyContactsChangedAfterResponse([ctx.userId, addresseeId]);
      return { success: true };
    }),

  removeUser: externalContactProcedure
    .input(z.object({ userId }))
    .mutation(async ({ ctx, input }) => {
      await ctx.contactModel.removeUser(input.userId);
      notifyContactsChangedAfterResponse([ctx.userId, input.userId]);
      return { success: true };
    }),

  /** A member opens themselves to one of the workspace's external contacts. */
  openToExternal: contactProcedure
    .use(requireWorkspaceRoleWhenScoped('member'))
    .input(z.object({ userId }))
    .mutation(async ({ ctx, input }) => {
      await ctx.contactModel.openTo(input.userId);
      notifyContactsChangedAfterResponse([ctx.userId, input.userId]);
      return { success: true };
    }),

  /** An owner or admin removes an external contact from the workspace. */
  removeExternal: contactProcedure
    .use(requireWorkspaceRoleWhenScoped('admin'))
    .input(z.object({ userId }))
    .mutation(async ({ ctx, input }) => {
      await ctx.contactModel.removeExternal(input.userId);
      notifyContactsChangedAfterResponse([ctx.userId, input.userId]);
      return { success: true };
    }),

  /** A person's profile, their relation to me and the Agents they share by link. */
  userProfile: externalContactProcedure
    .input(z.object({ userId }))
    .query(async ({ ctx, input }) => {
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
