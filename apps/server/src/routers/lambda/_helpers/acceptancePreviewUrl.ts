import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { verifyRuns } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

const isPreviewUrl = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
    );
  } catch {
    return false;
  }
};

export const previewUrlSchema = z
  .string()
  .max(2000)
  .refine(isPreviewUrl, 'Preview URL must be https, or http on a loopback address');

export const recordPreviewUrl = async (db: LobeChatDatabase, acceptanceId: string, url: string) => {
  const [run] = await db
    .select({ id: verifyRuns.id, roundIndex: verifyRuns.roundIndex })
    .from(verifyRuns)
    .where(eq(verifyRuns.acceptanceId, acceptanceId))
    .orderBy(desc(verifyRuns.roundIndex))
    .limit(1);
  if (!run) return null;
  await db
    .update(verifyRuns)
    .set({
      metadata: sql`coalesce(${verifyRuns.metadata}, '{}'::jsonb) || ${JSON.stringify({ previewUrl: url })}::jsonb`,
    })
    .where(eq(verifyRuns.id, run.id));
  return run;
};
