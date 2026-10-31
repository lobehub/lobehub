import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  userMemories,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
} from '../../../schemas';
import type { UserMemoryModelContext } from './context';

export const updateAccessMetrics = async (
  ctx: UserMemoryModelContext,
  memoryIds: string[],
  options?: { contextIds?: string[]; timestamp?: Date },
): Promise<void> => {
  const contextIds = options?.contextIds ?? [];
  const orderedMemoryIds = memoryIds.length > 1 ? [...memoryIds].sort() : memoryIds;
  const orderedContextIds = contextIds.length > 1 ? [...contextIds].sort() : contextIds;

  // Keep lock acquisition order deterministic to avoid deadlocks under concurrent updates
  if (orderedMemoryIds.length === 0 && orderedContextIds.length === 0) return;

  // Prefer server-side clock to avoid shipping duplicate timestamp params on every query.
  const now = options?.timestamp ? sql`${options.timestamp}` : sql`now()`;

  await ctx.db.transaction(async (tx) => {
    if (orderedMemoryIds.length > 0) {
      for (const memoryId of orderedMemoryIds) {
        await tx
          .update(userMemories)
          .set({
            accessedAt: now,
            accessedCount: sql`${userMemories.accessedCount} + 1`,
            lastAccessedAt: now,
          })
          .where(and(ctx.memoryWhere(userMemories), eq(userMemories.id, memoryId)));
      }

      const memories = await tx
        .select({
          id: userMemories.id,
          layer: userMemories.memoryLayer,
        })
        .from(userMemories)
        .where(and(ctx.memoryWhere(userMemories), inArray(userMemories.id, orderedMemoryIds)));

      const experienceIds = memories
        .filter((memory) => memory.layer === 'experience')
        .map((memory) => memory.id);
      if (experienceIds.length > 0) {
        await tx
          .update(userMemoriesExperiences)
          .set({ accessedAt: now })
          .where(
            and(
              ctx.memoryWhere(userMemoriesExperiences),
              inArray(userMemoriesExperiences.userMemoryId, experienceIds),
            ),
          );
      }

      const identityIds = memories
        .filter((memory) => memory.layer === 'identity')
        .map((memory) => memory.id);
      if (identityIds.length > 0) {
        await tx
          .update(userMemoriesIdentities)
          .set({ accessedAt: now })
          .where(
            and(
              ctx.memoryWhere(userMemoriesIdentities),
              inArray(userMemoriesIdentities.userMemoryId, identityIds),
            ),
          );
      }

      const preferenceIds = memories
        .filter((memory) => memory.layer === 'preference')
        .map((memory) => memory.id);
      if (preferenceIds.length > 0) {
        await tx
          .update(userMemoriesPreferences)
          .set({ accessedAt: now })
          .where(
            and(
              ctx.memoryWhere(userMemoriesPreferences),
              inArray(userMemoriesPreferences.userMemoryId, preferenceIds),
            ),
          );
      }
    }

    if (orderedContextIds.length > 0) {
      await tx
        .update(userMemoriesContexts)
        .set({ accessedAt: now })
        .where(
          and(
            ctx.memoryWhere(userMemoriesContexts),
            inArray(userMemoriesContexts.id, orderedContextIds),
          ),
        );
    }
  });
};
