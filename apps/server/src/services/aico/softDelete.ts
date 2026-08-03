/**
 * Soft account deletion for Aico — soft-delete + outbox key revoke + org residual settle.
 * Destructive hard-delete of financial history is forbidden.
 */
import { eq } from 'drizzle-orm';

import {
  AicoBillingModel,
  fingerprintEmail,
  fingerprintPhone,
  normalizeIranianPhoneForFingerprint,
} from '@/database/models/aicoBilling';
import { OrganizationModel } from '@/database/models/organization';
import {
  aicoAccountTombs,
  aicoKeyOutbox,
  organizationMembers,
  userWallets,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

export class AicoSoftDeleteService {
  private readonly orgModel: OrganizationModel;
  private readonly billingModel: AicoBillingModel;

  constructor(private readonly db: LobeChatDatabase) {
    this.orgModel = new OrganizationModel(db);
    this.billingModel = new AicoBillingModel(db);
  }

  /**
   * Soft-deletes a user account:
   * 1. Revoke local org memberships → outbox reclaim
   * 2. Freeze non-zero personal balance
   * 3. Anonymize email/phone; retain irreversible fingerprints in tomb
   * 4. Caller must also invalidate Better Auth sessions
   */
  softDeleteUser = async (params: {
    deletedByUserId?: string | null;
    userId: string;
  }) => {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, params.userId) });
    if (!user) throw new Error('USER_NOT_FOUND');

    const memberships = await this.db.query.organizationMembers.findMany({
      where: eq(organizationMembers.userId, params.userId),
    });

    for (const m of memberships) {
      if (m.status === 'active' || m.status === 'revocation_pending') {
        if (m.role === 'owner') {
          throw new Error('LAST_OWNER_MUST_TRANSFER_BEFORE_DELETE');
        }
        await this.orgModel.removeMember({ memberId: m.id, orgId: m.orgId });
        await this.db.insert(aicoKeyOutbox).values({
          action: 'reclaim_member',
          nextAttemptAt: new Date(),
          orgId: m.orgId,
          orgMemberId: m.id,
          payload: {
            createdByUserId: params.deletedByUserId ?? 'system',
            reason: 'account_delete',
          },
          status: 'pending',
          userId: params.userId,
        });
      }
    }

    const wallet = await this.billingModel.getUserWallet(params.userId);
    const personalMicro = Number(wallet?.balanceMicroUsd ?? 0);
    if (wallet) {
      await this.db
        .update(userWallets)
        .set({
          balanceMicroUsd: personalMicro > 0 ? 0 : Number(wallet.balanceMicroUsd ?? 0),
          frozenMicroUsd: personalMicro > 0 ? personalMicro : Number(wallet.frozenMicroUsd ?? 0),
          isActive: false,
        })
        .where(eq(userWallets.userId, params.userId));
    }

    await this.db.insert(aicoKeyOutbox).values({
      action: 'disable_user_key',
      nextAttemptAt: new Date(),
      status: 'pending',
      userId: params.userId,
    });

    let phoneFp: string | null = null;
    if (user.phone) {
      try {
        phoneFp = fingerprintPhone(normalizeIranianPhoneForFingerprint(user.phone));
      } catch {
        phoneFp = fingerprintPhone(user.phone);
      }
    }

    await this.db.insert(aicoAccountTombs).values({
      anonymizedEmailFingerprint: user.email ? fingerprintEmail(user.email) : null,
      anonymizedPhoneFingerprint: phoneFp,
      deletedAt: new Date(),
      deletedByUserId: params.deletedByUserId ?? null,
      frozenPersonalMicroUsd: personalMicro > 0 ? personalMicro : 0,
      userId: params.userId,
    });

    if (user.phone) {
      await this.billingModel.addAbuseBlocklist({
        phone: user.phone,
        reason: 'account_soft_deleted',
      });
    }

    await this.db
      .update(users)
      .set({
        email: `deleted+${params.userId}@invalid.local`,
        fullName: 'Deleted User',
        phone: null,
        phoneNumberVerified: false,
      } as any)
      .where(eq(users.id, params.userId));

    return { frozenPersonalMicroUsd: personalMicro, userId: params.userId };
  };
}
