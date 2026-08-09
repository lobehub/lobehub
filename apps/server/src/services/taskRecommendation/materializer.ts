import type { ChatTopicMetadata } from '@lobechat/types';
import { OnboardingTaskRecommendationSessionSchema } from '@lobechat/types';
import { and, eq, isNull } from 'drizzle-orm';

import { topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import type { CreateTaskInput } from '@/server/services/task';
import { TaskService } from '@/server/services/task';

export type TaskRecommendationMaterializationResult =
  { status: 'not-found' } | { status: 'stale' } | { status: 'success'; taskId: string };

interface MaterializeTaskRecommendationInput {
  assigneeAgentId: string;
  recommendationId: string;
  sessionId: string;
  topicId: string;
}

type CreateTaskInTransaction = (
  database: LobeChatDatabase,
  input: CreateTaskInput,
) => Promise<{ id: string }>;

/** Atomically materializes one recommendation and records its task mapping. */
export class TaskRecommendationMaterializer {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly createTask: CreateTaskInTransaction = (database, input) =>
      new TaskService(database, userId).createTask(input),
  ) {}

  /**
   * Creates at most one task for a recommendation, including across overlapping retries.
   *
   * Use when:
   * - A confirmed onboarding recommendation must become a real task
   * - A previous materialization request may be replayed
   *
   * Expects:
   * - A personal onboarding topic owned by this service's user
   *
   * Returns:
   * - A stable task ID, or a bounded stale/not-found result
   */
  materialize = async (
    input: MaterializeTaskRecommendationInput,
  ): Promise<TaskRecommendationMaterializationResult> =>
    this.db.transaction(async (transaction) => {
      // The topic row is the serialization point for both task creation and the persisted mapping.
      // If task creation or metadata persistence fails, the transaction rolls both changes back.
      const [topic] = await transaction
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(
          and(
            eq(topics.id, input.topicId),
            eq(topics.userId, this.userId),
            isNull(topics.workspaceId),
          ),
        )
        .for('update');
      const onboardingSession = topic?.metadata?.onboardingSession;
      if (!onboardingSession) return { status: 'not-found' };
      const parsed = OnboardingTaskRecommendationSessionSchema.safeParse(
        onboardingSession.taskRecommendations,
      );
      if (!parsed.success) return { status: 'not-found' };
      if (parsed.data.id !== input.sessionId) return { status: 'stale' };

      const existingTaskId = parsed.data.createdTaskIds[input.recommendationId];
      if (existingTaskId) return { status: 'success', taskId: existingTaskId };

      const recommendation = parsed.data.recommendations.find(
        ({ id }) => id === input.recommendationId,
      );
      if (!recommendation) return { status: 'not-found' };

      const sourceList = recommendation.sources.map(({ subject, title, url }) =>
        title || subject ? `- ${title ?? subject}: ${url}` : `- ${url}`,
      );
      const task = await this.createTask(transaction as unknown as LobeChatDatabase, {
        assigneeAgentId: input.assigneeAgentId,
        // NOTICE:
        // Task descriptions are stored in `tasks.description` as varchar(255).
        // Recommendation reasons allow 1000 characters, and source URLs can add several kilobytes.
        // Keep the complete execution context in `instruction`; this slice can be removed if the
        // database column is widened or TaskService begins normalizing descriptions centrally.
        description: recommendation.reason.slice(0, 255),
        instruction: `${recommendation.instruction}\n\nSources:\n${sourceList.join('\n')}`,
        name: recommendation.title,
        priority: 3,
        visibility: 'private',
      });
      const taskRecommendations = OnboardingTaskRecommendationSessionSchema.parse({
        ...parsed.data,
        createdTaskIds: {
          ...parsed.data.createdTaskIds,
          [recommendation.id]: task.id,
        },
        updatedAt: new Date().toISOString(),
      });
      const metadata: ChatTopicMetadata = {
        ...topic.metadata,
        onboardingSession: {
          ...onboardingSession,
          taskRecommendations,
        },
      };
      await transaction
        .update(topics)
        .set({ metadata })
        .where(
          and(
            eq(topics.id, input.topicId),
            eq(topics.userId, this.userId),
            isNull(topics.workspaceId),
          ),
        );

      return { status: 'success', taskId: task.id };
    });
}
