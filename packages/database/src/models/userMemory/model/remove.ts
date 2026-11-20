import { and, eq, inArray } from 'drizzle-orm';

import {
  userMemories,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesPreferences,
} from '../../../schemas';
import type { UserMemoryModelContext } from './context';

export const removeContextEntry = async (
  ctx: UserMemoryModelContext,
  contextId: string,
): Promise<boolean> => {
  return ctx.db.transaction(async (tx) => {
    const context = await tx.query.userMemoriesContexts.findFirst({
      where: and(eq(userMemoriesContexts.id, contextId), ctx.memoryWhere(userMemoriesContexts)),
    });

    if (!context) {
      return false;
    }

    // Delete associated user memories if any
    const memoryIds = Array.isArray(context.userMemoryIds)
      ? (context.userMemoryIds as string[])
      : [];

    // Delete the authorized child while its live-parent guard still matches.
    await tx
      .delete(userMemoriesContexts)
      .where(and(eq(userMemoriesContexts.id, contextId), ctx.memoryWhere(userMemoriesContexts)));

    if (memoryIds.length > 0) {
      await tx
        .delete(userMemories)
        .where(and(inArray(userMemories.id, memoryIds), ctx.memoryWhere(userMemories)));
    }

    return true;
  });
};

export const removeExperienceEntry = async (
  ctx: UserMemoryModelContext,
  experienceId: string,
): Promise<boolean> => {
  return ctx.db.transaction(async (tx) => {
    const experience = await tx.query.userMemoriesExperiences.findFirst({
      where: and(
        eq(userMemoriesExperiences.id, experienceId),
        ctx.memoryWhere(userMemoriesExperiences),
      ),
    });

    if (!experience || !experience.userMemoryId) {
      return false;
    }

    // Delete the base user memory (cascade will handle the experience)
    await tx
      .delete(userMemories)
      .where(and(eq(userMemories.id, experience.userMemoryId), ctx.memoryWhere(userMemories)));

    return true;
  });
};

export const removePreferenceEntry = async (
  ctx: UserMemoryModelContext,
  preferenceId: string,
): Promise<boolean> => {
  return ctx.db.transaction(async (tx) => {
    const preference = await tx.query.userMemoriesPreferences.findFirst({
      where: and(
        eq(userMemoriesPreferences.id, preferenceId),
        ctx.memoryWhere(userMemoriesPreferences),
      ),
    });

    if (!preference || !preference.userMemoryId) {
      return false;
    }

    // Delete the base user memory (cascade will handle the preference)
    await tx
      .delete(userMemories)
      .where(and(eq(userMemories.id, preference.userMemoryId), ctx.memoryWhere(userMemories)));

    return true;
  });
};

export const deleteMemory = async (ctx: UserMemoryModelContext, id: string): Promise<void> => {
  await ctx.db
    .delete(userMemories)
    .where(and(eq(userMemories.id, id), ctx.memoryWhere(userMemories)));
};

export const deleteAllMemories = async (ctx: UserMemoryModelContext): Promise<void> => {
  await ctx.db.delete(userMemories).where(ctx.memoryWhere(userMemories));
};
