// Fixture: a model annotates a vector-free row and checks an insert against the table.
import type { userMemoriesActivities, userMemoriesContexts } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export const listActivities = async (
  db: LobeChatDatabase,
  userId: string,
  // alint-expect
): Promise<
  Omit<typeof userMemoriesActivities.$inferSelect, 'narrativeVector' | 'feedbackVector'>[]
> =>
  db.query.userMemoriesActivities.findMany({
    where: (table, { eq }) => eq(table.userId, userId),
  });

export const contextValues = (userId: string, memoryId: string) =>
  ({
    title: 'CITIC enterprise deal',
    userId,
    userMemoryId: memoryId,
    // alint-expect
  }) satisfies typeof userMemoriesContexts.$inferInsert;
