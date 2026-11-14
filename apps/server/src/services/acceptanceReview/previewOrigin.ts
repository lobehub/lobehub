import { and, desc, eq, sql } from 'drizzle-orm';

import { verifyRuns } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

export const latestPreviewUrl = async (db: LobeChatDatabase, acceptanceId: string) => {
  const [run] = await db
    .select({ previewUrl: sql<string>`${verifyRuns.metadata}->>'previewUrl'` })
    .from(verifyRuns)
    .where(
      and(
        eq(verifyRuns.acceptanceId, acceptanceId),
        sql`${verifyRuns.metadata}->>'previewUrl' IS NOT NULL`,
      ),
    )
    .orderBy(desc(verifyRuns.roundIndex))
    .limit(1);
  return run?.previewUrl;
};

export const latestPreviewOrigin = async (db: LobeChatDatabase, acceptanceId: string) => {
  const previewUrl = await latestPreviewUrl(db, acceptanceId);
  if (!previewUrl) return undefined;
  try {
    return new URL(previewUrl).origin;
  } catch {
    return undefined;
  }
};
