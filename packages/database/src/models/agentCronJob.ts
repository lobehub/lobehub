import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';

import type {
  AgentCronJob,
  CreateAgentCronJobData,
  NewAgentCronJob,
  UpdateAgentCronJobData,
} from '../schemas/agentCronJob';
import { agentCronJobs } from '../schemas/agentCronJob';
import type { LobeChatDatabase } from '../type';

export class AgentCronJobModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId?: string) {
    this.db = db;
    this.userId = userId!;
  }

  // Create a new cron job
  async create(data: CreateAgentCronJobData): Promise<AgentCronJob> {
    const cronJob = await this.db
      .insert(agentCronJobs)
      .values({
        ...data,
        // Initialize remaining executions to match max executions
        remainingExecutions: data.maxExecutions,

        userId: this.userId,
      } as NewAgentCronJob)
      .returning();

    return cronJob[0];
  }

  // Find cron job by ID (with user ownership check)
  async findById(id: string): Promise<AgentCronJob | null> {
    const result = await this.db
      .select()
      .from(agentCronJobs)
      .where(and(eq(agentCronJobs.id, id), eq(agentCronJobs.userId, this.userId)))
      .limit(1);

    return result[0] || null;
  }

  // Find all cron jobs for a specific agent
  async findByAgentId(agentId: string): Promise<AgentCronJob[]> {
    return this.db
      .select()
      .from(agentCronJobs)
      .where(and(eq(agentCronJobs.agentId, agentId), eq(agentCronJobs.userId, this.userId)))
      .orderBy(desc(agentCronJobs.createdAt));
  }

  // Find all cron jobs for the user (across all agents)
  async findByUserId(): Promise<AgentCronJob[]> {
    return this.db
      .select()
      .from(agentCronJobs)
      .where(eq(agentCronJobs.userId, this.userId))
      .orderBy(desc(agentCronJobs.lastExecutedAt));
  }

  // Get all enabled cron jobs (system-wide for execution)
  static async getEnabledJobs(db: LobeChatDatabase): Promise<AgentCronJob[]> {
    return db
      .select()
      .from(agentCronJobs)
      .where(
        and(
          eq(agentCronJobs.enabled, true),
          or(gt(agentCronJobs.remainingExecutions, 0), isNull(agentCronJobs.remainingExecutions)),
        ),
      )
      .orderBy(agentCronJobs.lastExecutedAt);
  }

  // Update cron job
  async update(id: string, data: UpdateAgentCronJobData): Promise<AgentCronJob | null> {
    // Check if critical fields (cronPattern or timezone) are being changed
    // If so, reset lastExecutedAt to allow immediate execution with new schedule
    let shouldResetLastExecuted = false;

    if (data?.cronPattern !== undefined || data?.timezone !== undefined) {
      const existing = await this.findById(id);
      if (
        existing &&
        ((data?.cronPattern !== undefined && data?.cronPattern !== existing.cronPattern) ||
          (data?.timezone !== undefined && data?.timezone !== existing.timezone))
      ) {
        shouldResetLastExecuted = true;
      }
    }

    const updateData: Record<string, unknown> = {
      ...data,
      ...(shouldResetLastExecuted ? { lastExecutedAt: null } : {}),
      updatedAt: new Date(),
    };

    // When maxExecutions is updated, reset remainingExecutions to match
    // This ensures the new limit takes effect immediately
    if (data?.maxExecutions !== undefined) {
      updateData.remainingExecutions = data.maxExecutions;
    }

    const result = await this.db
      .update(agentCronJobs)
      .set(updateData)
      .where(and(eq(agentCronJobs.id, id), eq(agentCronJobs.userId, this.userId)))
      .returning();

    return result[0] || null;
  }

  // Delete cron job
  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(agentCronJobs)
      .where(and(eq(agentCronJobs.id, id), eq(agentCronJobs.userId, this.userId)))
      .returning();

    return result.length > 0;
  }

  // Update execution statistics after job execution
  static async updateExecutionStats(
    db: LobeChatDatabase,
    jobId: string,
  ): Promise<AgentCronJob | null> {
    // Update execution statistics and decrement remaining executions
    const result = await db
      .update(agentCronJobs)
      .set({
        lastExecutedAt: new Date(),
        remainingExecutions: sql`
          CASE 
            WHEN ${agentCronJobs.remainingExecutions} IS NULL THEN NULL
            ELSE ${agentCronJobs.remainingExecutions} - 1
          END
        `,
        totalExecutions: sql`${agentCronJobs.totalExecutions} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(agentCronJobs.id, jobId))
      .returning();

    const updatedJob = result[0];

    // Auto-disable job if remaining executions reached 0
    if (updatedJob && updatedJob.remainingExecutions === 0) {
      await db
        .update(agentCronJobs)
        .set({
          enabled: false,
          updatedAt: new Date(),
        })
        .where(eq(agentCronJobs.id, jobId));

      // Return updated job with enabled = false
      return { ...updatedJob, enabled: false };
    }

    return updatedJob || null;
  }

  // Reset execution counts and re-enable job
  async resetExecutions(id: string, newMaxExecutions?: number): Promise<AgentCronJob | null> {
    const result = await this.db
      .update(agentCronJobs)
      .set({
        enabled: true,
        // Re-enable job when resetting
        lastExecutedAt: null,

        maxExecutions: newMaxExecutions,

        remainingExecutions: newMaxExecutions,
        totalExecutions: 0,
        updatedAt: new Date(),
      })
      .where(and(eq(agentCronJobs.id, id), eq(agentCronJobs.userId, this.userId)))
      .returning();

    return result[0] || null;
  }

  // Get jobs that are near depletion (for warnings)
  async getTasksNearDepletion(threshold: number = 5): Promise<AgentCronJob[]> {
    return this.db
      .select()
      .from(agentCronJobs)
      .where(
        and(
          eq(agentCronJobs.userId, this.userId),
          eq(agentCronJobs.enabled, true),
          gt(agentCronJobs.remainingExecutions, 0),
          sql`${agentCronJobs.remainingExecutions} <= ${threshold}`,
        ),
      )
      .orderBy(agentCronJobs.remainingExecutions);
  }

  // Get jobs by execution status
  async findByStatus(enabled: boolean): Promise<AgentCronJob[]> {
    return this.db
      .select()
      .from(agentCronJobs)
      .where(and(eq(agentCronJobs.userId, this.userId), eq(agentCronJobs.enabled, enabled)))
      .orderBy(desc(agentCronJobs.updatedAt));
  }

  // Get execution statistics for dashboard
  async getExecutionStats(): Promise<{
    activeJobs: number;
    completedExecutions: number;
    pendingExecutions: number;
    totalJobs: number;
  }> {
    const result = await this.db
      .select({
        activeJobs: sql<number>`sum(case when ${agentCronJobs.enabled} then 1 else 0 end)`,
        completedExecutions: sql<number>`sum(${agentCronJobs.totalExecutions})`,
        pendingExecutions: sql<number>`
          sum(
                    case when ${agentCronJobs.remainingExecutions} is null then 999999
                    else coalesce(${agentCronJobs.remainingExecutions}, 0) end
                  )
        `,
        totalJobs: sql<number>`count(*)`,
      })
      .from(agentCronJobs)
      .where(eq(agentCronJobs.userId, this.userId));

    const stats = result[0];
    return {
      activeJobs: Number(stats.activeJobs),
      completedExecutions: Number(stats.completedExecutions),
      pendingExecutions: Number(stats.pendingExecutions === 999_999 ? 0 : stats.pendingExecutions),
      totalJobs: Number(stats.totalJobs),
    };
  }

  // Batch enable/disable jobs
  async batchUpdateStatus(ids: string[], enabled: boolean): Promise<number> {
    const result = await this.db
      .update(agentCronJobs)
      .set({
        enabled,
        updatedAt: new Date(),
      })
      .where(and(inArray(agentCronJobs.id, ids), eq(agentCronJobs.userId, this.userId)))
      .returning();

    return result.length;
  }

  // Count total jobs for pagination
  async countByAgentId(agentId: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(agentCronJobs)
      .where(and(eq(agentCronJobs.agentId, agentId), eq(agentCronJobs.userId, this.userId)));

    return Number(result[0].count);
  }

  // Find jobs with pagination
  async findWithPagination(options: {
    agentId?: string;
    enabled?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ jobs: AgentCronJob[]; total: number }> {
    const { agentId, enabled, limit = 20, offset = 0 } = options;

    const whereConditions = [eq(agentCronJobs.userId, this.userId)];

    if (agentId) {
      whereConditions.push(eq(agentCronJobs.agentId, agentId));
    }

    if (enabled !== undefined) {
      whereConditions.push(eq(agentCronJobs.enabled, enabled));
    }

    const whereClause = and(...whereConditions);

    // Get total count
    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(agentCronJobs)
      .where(whereClause);

    const total = Number(countResult[0].count);

    // Get paginated results
    const jobs = await this.db
      .select()
      .from(agentCronJobs)
      .where(whereClause)
      .orderBy(desc(agentCronJobs.createdAt))
      .limit(limit)
      .offset(offset);

    return { jobs, total };
  }
}
