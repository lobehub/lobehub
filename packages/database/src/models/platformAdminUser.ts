import { and, desc, eq, gt, lt } from 'drizzle-orm';

import {
  type PlatformAdminSessionItem,
  platformAdminSessions,
  type PlatformAdminUserItem,
  platformAdminUsers,
} from '../schemas/aicoOrganization';
import type { LobeChatDatabase } from '../type';

export const normalizeOperatorEmail = (email: string) => email.trim().toLowerCase();

export class PlatformAdminUserModel {
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  findById = async (id: string): Promise<PlatformAdminUserItem | undefined> => {
    return this.db.query.platformAdminUsers.findFirst({
      where: eq(platformAdminUsers.id, id),
    });
  };

  findActiveById = async (id: string): Promise<PlatformAdminUserItem | undefined> => {
    return this.db.query.platformAdminUsers.findFirst({
      where: and(eq(platformAdminUsers.id, id), eq(platformAdminUsers.banned, false)),
    });
  };

  findByEmail = async (email: string): Promise<PlatformAdminUserItem | undefined> => {
    return this.db.query.platformAdminUsers.findFirst({
      where: eq(platformAdminUsers.email, normalizeOperatorEmail(email)),
    });
  };

  list = async (): Promise<PlatformAdminUserItem[]> => {
    return this.db.query.platformAdminUsers.findMany({
      orderBy: [desc(platformAdminUsers.createdAt)],
    });
  };

  create = async (params: {
    email: string;
    name?: string | null;
    passwordHash: string;
  }): Promise<PlatformAdminUserItem> => {
    const [row] = await this.db
      .insert(platformAdminUsers)
      .values({
        email: normalizeOperatorEmail(params.email),
        name: params.name ?? null,
        passwordHash: params.passwordHash,
      })
      .returning();
    return row;
  };

  upsertByEmail = async (params: {
    email: string;
    name?: string | null;
    passwordHash: string;
  }): Promise<PlatformAdminUserItem> => {
    const email = normalizeOperatorEmail(params.email);
    const existing = await this.findByEmail(email);
    if (existing) {
      const [row] = await this.db
        .update(platformAdminUsers)
        .set({
          banned: false,
          name: params.name ?? existing.name,
          passwordHash: params.passwordHash,
        })
        .where(eq(platformAdminUsers.id, existing.id))
        .returning();
      return row;
    }
    return this.create({ email, name: params.name, passwordHash: params.passwordHash });
  };

  createSession = async (params: {
    adminUserId: string;
    expiresAt: Date;
    ipAddress?: string | null;
    tokenHash: string;
    userAgent?: string | null;
  }): Promise<PlatformAdminSessionItem> => {
    const [row] = await this.db
      .insert(platformAdminSessions)
      .values({
        adminUserId: params.adminUserId,
        expiresAt: params.expiresAt,
        ipAddress: params.ipAddress ?? null,
        tokenHash: params.tokenHash,
        userAgent: params.userAgent ?? null,
      })
      .returning();
    return row;
  };

  findValidSessionByTokenHash = async (tokenHash: string) => {
    const session = await this.db.query.platformAdminSessions.findFirst({
      where: and(
        eq(platformAdminSessions.tokenHash, tokenHash),
        gt(platformAdminSessions.expiresAt, new Date()),
      ),
    });
    if (!session) return undefined;
    const admin = await this.findActiveById(session.adminUserId);
    if (!admin) return undefined;
    return { admin, session };
  };

  deleteSessionByTokenHash = async (tokenHash: string) => {
    await this.db
      .delete(platformAdminSessions)
      .where(eq(platformAdminSessions.tokenHash, tokenHash));
  };

  deleteExpiredSessions = async () => {
    await this.db
      .delete(platformAdminSessions)
      .where(lt(platformAdminSessions.expiresAt, new Date()));
  };
}
