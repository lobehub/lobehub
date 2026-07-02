import { INVITATION_EXPIRY_DAYS } from '@lobechat/const';
import { and, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid/non-secure';

import { workspaceInvitations, workspaceMembers } from '../schemas/workspace';
import type { LobeChatDatabase } from '../type';

type MemberRole = 'member' | 'owner' | 'viewer';

export class WorkspaceMemberModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  // ===== Members ===== //

  addMember = async (params: { role?: MemberRole; userId: string; workspaceId: string }) => {
    const [result] = await this.db
      .insert(workspaceMembers)
      .values({
        role: params.role ?? 'member',
        userId: params.userId,
        workspaceId: params.workspaceId,
      })
      .onConflictDoUpdate({
        set: {
          deletedAt: null,
          joinedAt: new Date(),
          role: params.role ?? 'member',
        },
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
      })
      .returning();
    return result;
  };

  getMember = async (workspaceId: string, userId: string) => {
    return this.db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        isNull(workspaceMembers.deletedAt),
      ),
    });
  };

  listMembers = async (workspaceId: string, options: { includeDeleted?: boolean } = {}) => {
    return this.db.query.workspaceMembers.findMany({
      where: options.includeDeleted
        ? eq(workspaceMembers.workspaceId, workspaceId)
        : and(eq(workspaceMembers.workspaceId, workspaceId), isNull(workspaceMembers.deletedAt)),
    });
  };

  removeMember = async (workspaceId: string, userId: string) => {
    return this.db
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
          isNull(workspaceMembers.deletedAt),
        ),
      );
  };

  updateMemberRole = async (workspaceId: string, userId: string, role: MemberRole) => {
    return this.db
      .update(workspaceMembers)
      .set({ role })
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
          isNull(workspaceMembers.deletedAt),
        ),
      );
  };

  // ===== Invitations ===== //

  createInvitation = async (params: { email?: string; role?: MemberRole; workspaceId: string }) => {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

    const [result] = await this.db
      .insert(workspaceInvitations)
      .values({
        email: params.email,
        expiresAt,
        inviterId: this.userId,
        role: params.role ?? 'member',
        token: nanoid(32),
        workspaceId: params.workspaceId,
      })
      .returning();
    return result;
  };

  findInvitationByToken = async (token: string) => {
    return this.db.query.workspaceInvitations.findFirst({
      where: eq(workspaceInvitations.token, token),
    });
  };

  listPendingInvitations = async (workspaceId: string) => {
    return this.db.query.workspaceInvitations.findMany({
      where: and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        eq(workspaceInvitations.status, 'pending'),
      ),
    });
  };

  revokeInvitation = async (id: string) => {
    return this.db
      .update(workspaceInvitations)
      .set({ status: 'revoked' })
      .where(eq(workspaceInvitations.id, id));
  };

  updateInvitationStatus = async (id: string, status: 'accepted' | 'expired' | 'revoked') => {
    return this.db
      .update(workspaceInvitations)
      .set({ status })
      .where(eq(workspaceInvitations.id, id));
  };
}
