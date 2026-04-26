import { and, eq, isNotNull, or, sql } from 'drizzle-orm';

import { userTaskTemplateInteractions } from '../schemas';
import type { LobeChatDatabase } from '../type';

export class UserTaskTemplateInteractionModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  /** Idempotent — `firstCreatedAt` is preserved on subsequent calls (sticky). */
  recordCreated = async (templateId: string) => {
    await this.db
      .insert(userTaskTemplateInteractions)
      .values({ userId: this.userId, templateId, firstCreatedAt: new Date() })
      .onConflictDoUpdate({
        target: [userTaskTemplateInteractions.userId, userTaskTemplateInteractions.templateId],
        set: {
          firstCreatedAt: sql`COALESCE(${userTaskTemplateInteractions.firstCreatedAt}, NOW())`,
          updatedAt: new Date(),
        },
      });
  };

  /** Idempotent — `dismissedAt` is refreshed to the latest dismissal time. */
  dismiss = async (templateId: string) => {
    const now = new Date();
    await this.db
      .insert(userTaskTemplateInteractions)
      .values({ userId: this.userId, templateId, dismissedAt: now })
      .onConflictDoUpdate({
        target: [userTaskTemplateInteractions.userId, userTaskTemplateInteractions.templateId],
        set: { dismissedAt: now, updatedAt: now },
      });
  };

  /** Templates the user has either created from or dismissed — exclude these from recommendations. */
  listExcludedTemplateIds = async (): Promise<string[]> => {
    const rows = await this.db
      .select({ templateId: userTaskTemplateInteractions.templateId })
      .from(userTaskTemplateInteractions)
      .where(
        and(
          eq(userTaskTemplateInteractions.userId, this.userId),
          or(
            isNotNull(userTaskTemplateInteractions.firstCreatedAt),
            isNotNull(userTaskTemplateInteractions.dismissedAt),
          ),
        ),
      );
    return rows.map((r) => r.templateId);
  };
}
