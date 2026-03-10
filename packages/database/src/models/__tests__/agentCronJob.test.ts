// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentCronJobs, agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentCronJobModel } from '../agentCronJob';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-cron-job-test-user-id';
const userId2 = 'agent-cron-job-test-user-id-2';
let agentId: string;
let agentId2: string;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);

  // Create test agents
  const [agent] = await serverDB.insert(agents).values({ userId, title: 'Test Agent' }).returning();
  agentId = agent.id;

  const [agent2] = await serverDB
    .insert(agents)
    .values({ userId: userId2, title: 'Test Agent 2' })
    .returning();
  agentId2 = agent2.id;
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentCronJobModel', () => {
  describe('constructor', () => {
    it('should create model with db and userId', () => {
      const model = new AgentCronJobModel(serverDB, userId);
      expect(model).toBeInstanceOf(AgentCronJobModel);
    });
  });

  describe('create', () => {
    it('should create a cron job with required fields', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const result = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Test cron job content',
      });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.agentId).toBe(agentId);
      expect(result.userId).toBe(userId);
      expect(result.cronPattern).toBe('0 * * * *');
      expect(result.content).toBe('Test cron job content');
      expect(result.enabled).toBe(true);
      expect(result.timezone).toBe('UTC');
      expect(result.totalExecutions).toBe(0);
    });

    it('should set remainingExecutions equal to maxExecutions', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const result = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Limited cron job',
        maxExecutions: 10,
      });

      expect(result.maxExecutions).toBe(10);
      expect(result.remainingExecutions).toBe(10);
    });

    it('should leave remainingExecutions null when maxExecutions is not set', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const result = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Unlimited cron job',
      });

      expect(result.maxExecutions).toBeNull();
      expect(result.remainingExecutions).toBeNull();
    });

    it('should create a cron job with optional fields', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const result = await model.create({
        agentId,
        cronPattern: '*/30 * * * *',
        content: 'Full cron job',
        name: 'Daily Report',
        description: 'Generates daily report',
        timezone: 'America/New_York',
        maxExecutions: 100,
        enabled: false,
      });

      expect(result.name).toBe('Daily Report');
      expect(result.description).toBe('Generates daily report');
      expect(result.timezone).toBe('America/New_York');
      expect(result.maxExecutions).toBe(100);
      expect(result.remainingExecutions).toBe(100);
      expect(result.enabled).toBe(false);
    });
  });

  describe('findById', () => {
    it('should find a cron job by id with user ownership check', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const created = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Find by id test',
      });

      const found = await model.findById(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.content).toBe('Find by id test');
    });

    it('should return null when job belongs to another user', async () => {
      const model1 = new AgentCronJobModel(serverDB, userId);
      const created = await model1.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'User 1 job',
      });

      const model2 = new AgentCronJobModel(serverDB, userId2);
      const found = await model2.findById(created.id);
      expect(found).toBeNull();
    });

    it('should return null for non-existent id', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const found = await model.findById('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('findByAgentId', () => {
    it('should find all cron jobs for a specific agent', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      await model.create({ agentId, cronPattern: '0 * * * *', content: 'Job 1' });
      await model.create({ agentId, cronPattern: '30 * * * *', content: 'Job 2' });

      const jobs = await model.findByAgentId(agentId);
      expect(jobs).toHaveLength(2);
    });

    it('should order results by createdAt desc', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      await model.create({ agentId, cronPattern: '0 * * * *', content: 'First' });

      // Insert a small delay to ensure distinct createdAt timestamps
      await serverDB.insert(agentCronJobs).values({
        agentId,
        userId,
        cronPattern: '30 * * * *',
        content: 'Second',
        createdAt: new Date(Date.now() + 1000),
      });

      const jobs = await model.findByAgentId(agentId);
      expect(jobs[0].content).toBe('Second');
      expect(jobs[1].content).toBe('First');
    });

    it('should not return jobs from another user', async () => {
      const model1 = new AgentCronJobModel(serverDB, userId);
      await model1.create({ agentId, cronPattern: '0 * * * *', content: 'User 1 job' });

      const model2 = new AgentCronJobModel(serverDB, userId2);
      const jobs = await model2.findByAgentId(agentId);
      expect(jobs).toHaveLength(0);
    });
  });

  describe('findByUserId', () => {
    it('should find all cron jobs for the user', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      await model.create({ agentId, cronPattern: '0 * * * *', content: 'Job 1' });
      await model.create({ agentId, cronPattern: '30 * * * *', content: 'Job 2' });

      const jobs = await model.findByUserId();
      expect(jobs).toHaveLength(2);
    });

    it('should not include jobs from other users', async () => {
      const model1 = new AgentCronJobModel(serverDB, userId);
      await model1.create({ agentId, cronPattern: '0 * * * *', content: 'User 1 job' });

      const model2 = new AgentCronJobModel(serverDB, userId2);
      await model2.create({ agentId: agentId2, cronPattern: '0 * * * *', content: 'User 2 job' });

      const jobs1 = await model1.findByUserId();
      expect(jobs1).toHaveLength(1);
      expect(jobs1[0].content).toBe('User 1 job');

      const jobs2 = await model2.findByUserId();
      expect(jobs2).toHaveLength(1);
      expect(jobs2[0].content).toBe('User 2 job');
    });
  });

  describe('getEnabledJobs (static)', () => {
    it('should return enabled jobs with remaining executions > 0', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Enabled with remaining',
        maxExecutions: 5,
      });

      const jobs = await AgentCronJobModel.getEnabledJobs(serverDB);
      expect(jobs.length).toBeGreaterThanOrEqual(1);
      expect(jobs.some((j) => j.content === 'Enabled with remaining')).toBe(true);
    });

    it('should return enabled jobs with null remainingExecutions (unlimited)', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Unlimited job',
      });

      const jobs = await AgentCronJobModel.getEnabledJobs(serverDB);
      expect(jobs.some((j) => j.content === 'Unlimited job')).toBe(true);
    });

    it('should not return disabled jobs', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Disabled job',
        enabled: false,
      });

      const jobs = await AgentCronJobModel.getEnabledJobs(serverDB);
      expect(jobs.some((j) => j.content === 'Disabled job')).toBe(false);
    });

    it('should not return jobs with 0 remaining executions', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const job = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Depleted job',
        maxExecutions: 1,
      });

      // Manually set remainingExecutions to 0
      await serverDB
        .update(agentCronJobs)
        .set({ remainingExecutions: 0 })
        .where(eq(agentCronJobs.id, job.id));

      const jobs = await AgentCronJobModel.getEnabledJobs(serverDB);
      expect(jobs.some((j) => j.content === 'Depleted job')).toBe(false);
    });
  });

  describe('update', () => {
    it('should update a cron job', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const created = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Original content',
      });

      const updated = await model.update(created.id, { content: 'Updated content' });
      expect(updated).not.toBeNull();
      expect(updated!.content).toBe('Updated content');
    });

    it('should reset lastExecutedAt when cronPattern changes', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const created = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Cron change test',
      });

      // Manually set lastExecutedAt
      await serverDB
        .update(agentCronJobs)
        .set({ lastExecutedAt: new Date() })
        .where(eq(agentCronJobs.id, created.id));

      const updated = await model.update(created.id, { cronPattern: '30 * * * *' });
      expect(updated).not.toBeNull();
      expect(updated!.lastExecutedAt).toBeNull();
      expect(updated!.cronPattern).toBe('30 * * * *');
    });

    it('should reset lastExecutedAt when timezone changes', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const created = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Timezone change test',
      });

      // Manually set lastExecutedAt
      await serverDB
        .update(agentCronJobs)
        .set({ lastExecutedAt: new Date() })
        .where(eq(agentCronJobs.id, created.id));

      const updated = await model.update(created.id, { timezone: 'Asia/Tokyo' });
      expect(updated).not.toBeNull();
      expect(updated!.lastExecutedAt).toBeNull();
      expect(updated!.timezone).toBe('Asia/Tokyo');
    });

    it('should NOT reset lastExecutedAt when non-critical fields change', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const created = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Non-critical update test',
      });

      const executedAt = new Date('2025-01-01T00:00:00Z');
      await serverDB
        .update(agentCronJobs)
        .set({ lastExecutedAt: executedAt })
        .where(eq(agentCronJobs.id, created.id));

      const updated = await model.update(created.id, {
        name: 'New name',
        description: 'New description',
      });
      expect(updated).not.toBeNull();
      expect(updated!.lastExecutedAt).toEqual(executedAt);
    });

    it('should NOT reset lastExecutedAt when cronPattern is same value', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const created = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Same cron test',
      });

      const executedAt = new Date('2025-01-01T00:00:00Z');
      await serverDB
        .update(agentCronJobs)
        .set({ lastExecutedAt: executedAt })
        .where(eq(agentCronJobs.id, created.id));

      const updated = await model.update(created.id, { cronPattern: '0 * * * *' });
      expect(updated).not.toBeNull();
      expect(updated!.lastExecutedAt).toEqual(executedAt);
    });

    it('should reset remainingExecutions when maxExecutions changes', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const created = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Max exec change',
        maxExecutions: 10,
      });

      // Simulate some executions
      await serverDB
        .update(agentCronJobs)
        .set({ remainingExecutions: 3 })
        .where(eq(agentCronJobs.id, created.id));

      const updated = await model.update(created.id, { maxExecutions: 50 });
      expect(updated).not.toBeNull();
      expect(updated!.maxExecutions).toBe(50);
      expect(updated!.remainingExecutions).toBe(50);
    });

    it('should return null when updating job that belongs to another user', async () => {
      const model1 = new AgentCronJobModel(serverDB, userId);
      const created = await model1.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'User 1 job',
      });

      const model2 = new AgentCronJobModel(serverDB, userId2);
      const result = await model2.update(created.id, { content: 'Hijacked' });
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete a cron job and return true', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const created = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'To delete',
      });

      const result = await model.delete(created.id);
      expect(result).toBe(true);

      const found = await model.findById(created.id);
      expect(found).toBeNull();
    });

    it('should return false when deleting non-existent job', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const result = await model.delete('non-existent-id');
      expect(result).toBe(false);
    });

    it('should not delete job belonging to another user', async () => {
      const model1 = new AgentCronJobModel(serverDB, userId);
      const created = await model1.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Protected job',
      });

      const model2 = new AgentCronJobModel(serverDB, userId2);
      const result = await model2.delete(created.id);
      expect(result).toBe(false);

      // Verify not deleted
      const found = await model1.findById(created.id);
      expect(found).not.toBeNull();
    });
  });

  describe('updateExecutionStats (static)', () => {
    it('should increment totalExecutions and set lastExecutedAt', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const created = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Stats test',
      });

      const updated = await AgentCronJobModel.updateExecutionStats(serverDB, created.id);
      expect(updated).not.toBeNull();
      expect(updated!.totalExecutions).toBe(1);
      expect(updated!.lastExecutedAt).not.toBeNull();
    });

    it('should decrement remainingExecutions', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const created = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Decrement test',
        maxExecutions: 5,
      });

      const updated = await AgentCronJobModel.updateExecutionStats(serverDB, created.id);
      expect(updated).not.toBeNull();
      expect(updated!.remainingExecutions).toBe(4);
      expect(updated!.totalExecutions).toBe(1);
    });

    it('should keep null remainingExecutions as null (unlimited)', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const created = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Unlimited stats test',
      });

      const updated = await AgentCronJobModel.updateExecutionStats(serverDB, created.id);
      expect(updated).not.toBeNull();
      expect(updated!.remainingExecutions).toBeNull();
      expect(updated!.totalExecutions).toBe(1);
    });

    it('should auto-disable job when remainingExecutions reaches 0', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const created = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Auto-disable test',
        maxExecutions: 1,
      });

      const updated = await AgentCronJobModel.updateExecutionStats(serverDB, created.id);
      expect(updated).not.toBeNull();
      expect(updated!.remainingExecutions).toBe(0);
      expect(updated!.enabled).toBe(false);

      // Verify in database
      const found = await model.findById(created.id);
      expect(found).not.toBeNull();
      expect(found!.enabled).toBe(false);
    });

    it('should return null for non-existent job id', async () => {
      const updated = await AgentCronJobModel.updateExecutionStats(serverDB, 'non-existent-id');
      expect(updated).toBeNull();
    });
  });

  describe('resetExecutions', () => {
    it('should re-enable job and reset all counters', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const created = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Reset test',
        maxExecutions: 5,
      });

      // Execute until depleted
      for (let i = 0; i < 5; i++) {
        await AgentCronJobModel.updateExecutionStats(serverDB, created.id);
      }

      // Verify disabled
      const depleted = await model.findById(created.id);
      expect(depleted!.enabled).toBe(false);
      expect(depleted!.remainingExecutions).toBe(0);

      // Reset with new max
      const reset = await model.resetExecutions(created.id, 20);
      expect(reset).not.toBeNull();
      expect(reset!.enabled).toBe(true);
      expect(reset!.maxExecutions).toBe(20);
      expect(reset!.remainingExecutions).toBe(20);
      expect(reset!.totalExecutions).toBe(0);
      expect(reset!.lastExecutedAt).toBeNull();
    });

    it('should reset without new max executions (keeps old maxExecutions)', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const created = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Reset unlimited test',
        maxExecutions: 3,
      });

      // When newMaxExecutions is not provided, Drizzle passes undefined
      // which means "don't update this field", so old values are kept
      const reset = await model.resetExecutions(created.id);
      expect(reset).not.toBeNull();
      expect(reset!.enabled).toBe(true);
      expect(reset!.totalExecutions).toBe(0);
      expect(reset!.lastExecutedAt).toBeNull();
      // maxExecutions and remainingExecutions keep their old values
      // because undefined means "don't update" in Drizzle
      expect(reset!.maxExecutions).toBe(3);
      expect(reset!.remainingExecutions).toBe(3);
    });

    it('should return null for job belonging to another user', async () => {
      const model1 = new AgentCronJobModel(serverDB, userId);
      const created = await model1.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Other user reset test',
      });

      const model2 = new AgentCronJobModel(serverDB, userId2);
      const result = await model2.resetExecutions(created.id);
      expect(result).toBeNull();
    });
  });

  describe('getTasksNearDepletion', () => {
    it('should return enabled jobs with remainingExecutions <= threshold', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const job = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Near depletion',
        maxExecutions: 3,
      });

      const nearDepleted = await model.getTasksNearDepletion(5);
      expect(nearDepleted.some((j) => j.id === job.id)).toBe(true);
    });

    it('should use default threshold of 5', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Default threshold test',
        maxExecutions: 4,
      });

      const nearDepleted = await model.getTasksNearDepletion();
      expect(nearDepleted.some((j) => j.content === 'Default threshold test')).toBe(true);
    });

    it('should not return jobs with remainingExecutions > threshold', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Many remaining',
        maxExecutions: 100,
      });

      const nearDepleted = await model.getTasksNearDepletion(5);
      expect(nearDepleted.some((j) => j.content === 'Many remaining')).toBe(false);
    });

    it('should not return disabled jobs', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Disabled near depletion',
        maxExecutions: 2,
        enabled: false,
      });

      const nearDepleted = await model.getTasksNearDepletion(5);
      expect(nearDepleted.some((j) => j.content === 'Disabled near depletion')).toBe(false);
    });

    it('should not return jobs with null remainingExecutions (unlimited)', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Unlimited not near depletion',
      });

      const nearDepleted = await model.getTasksNearDepletion(5);
      expect(nearDepleted.some((j) => j.content === 'Unlimited not near depletion')).toBe(false);
    });

    it('should not return jobs with 0 remaining executions', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const job = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Zero remaining',
        maxExecutions: 1,
      });

      // Deplete the job
      await serverDB
        .update(agentCronJobs)
        .set({ remainingExecutions: 0 })
        .where(eq(agentCronJobs.id, job.id));

      const nearDepleted = await model.getTasksNearDepletion(5);
      expect(nearDepleted.some((j) => j.content === 'Zero remaining')).toBe(false);
    });
  });

  describe('findByStatus', () => {
    it('should find enabled jobs', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Enabled',
        enabled: true,
      });
      await model.create({
        agentId,
        cronPattern: '30 * * * *',
        content: 'Disabled',
        enabled: false,
      });

      const enabled = await model.findByStatus(true);
      expect(enabled).toHaveLength(1);
      expect(enabled[0].content).toBe('Enabled');
    });

    it('should find disabled jobs', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Enabled',
        enabled: true,
      });
      await model.create({
        agentId,
        cronPattern: '30 * * * *',
        content: 'Disabled',
        enabled: false,
      });

      const disabled = await model.findByStatus(false);
      expect(disabled).toHaveLength(1);
      expect(disabled[0].content).toBe('Disabled');
    });

    it('should only return jobs for the current user', async () => {
      const model1 = new AgentCronJobModel(serverDB, userId);
      await model1.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'User 1 enabled',
      });

      const model2 = new AgentCronJobModel(serverDB, userId2);
      await model2.create({
        agentId: agentId2,
        cronPattern: '0 * * * *',
        content: 'User 2 enabled',
      });

      const jobs1 = await model1.findByStatus(true);
      expect(jobs1).toHaveLength(1);
      expect(jobs1[0].content).toBe('User 1 enabled');
    });
  });

  describe('getExecutionStats', () => {
    it('should return aggregate stats for the user', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Active job 1',
        enabled: true,
        maxExecutions: 10,
      });
      await model.create({
        agentId,
        cronPattern: '30 * * * *',
        content: 'Disabled job',
        enabled: false,
        maxExecutions: 5,
      });

      // Execute active job once
      const jobs = await model.findByStatus(true);
      await AgentCronJobModel.updateExecutionStats(serverDB, jobs[0].id);

      const stats = await model.getExecutionStats();
      expect(stats.totalJobs).toBe(2);
      expect(stats.activeJobs).toBe(1);
      expect(stats.completedExecutions).toBe(1);
    });

    it('should return zeros when user has no jobs', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const stats = await model.getExecutionStats();
      expect(stats.totalJobs).toBe(0);
      expect(stats.activeJobs).toBe(0);
      expect(stats.completedExecutions).toBe(0);
      expect(stats.pendingExecutions).toBe(0);
    });

    it('should not include jobs from other users', async () => {
      const model1 = new AgentCronJobModel(serverDB, userId);
      await model1.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'User 1 job',
        maxExecutions: 10,
      });

      const model2 = new AgentCronJobModel(serverDB, userId2);
      await model2.create({
        agentId: agentId2,
        cronPattern: '0 * * * *',
        content: 'User 2 job',
        maxExecutions: 20,
      });

      const stats1 = await model1.getExecutionStats();
      expect(stats1.totalJobs).toBe(1);

      const stats2 = await model2.getExecutionStats();
      expect(stats2.totalJobs).toBe(1);
    });
  });

  describe('batchUpdateStatus', () => {
    it('should enable multiple jobs at once', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const job1 = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Batch 1',
        enabled: false,
      });
      const job2 = await model.create({
        agentId,
        cronPattern: '30 * * * *',
        content: 'Batch 2',
        enabled: false,
      });

      const count = await model.batchUpdateStatus([job1.id, job2.id], true);
      expect(count).toBe(2);

      const updated1 = await model.findById(job1.id);
      const updated2 = await model.findById(job2.id);
      expect(updated1!.enabled).toBe(true);
      expect(updated2!.enabled).toBe(true);
    });

    it('should disable multiple jobs at once', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const job1 = await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Batch disable 1',
      });
      const job2 = await model.create({
        agentId,
        cronPattern: '30 * * * *',
        content: 'Batch disable 2',
      });

      const count = await model.batchUpdateStatus([job1.id, job2.id], false);
      expect(count).toBe(2);

      const updated1 = await model.findById(job1.id);
      const updated2 = await model.findById(job2.id);
      expect(updated1!.enabled).toBe(false);
      expect(updated2!.enabled).toBe(false);
    });

    it('should only update jobs belonging to the user', async () => {
      const model1 = new AgentCronJobModel(serverDB, userId);
      const job1 = await model1.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'User 1 batch',
      });

      const model2 = new AgentCronJobModel(serverDB, userId2);
      const count = await model2.batchUpdateStatus([job1.id], false);
      expect(count).toBe(0);

      // Verify not changed
      const found = await model1.findById(job1.id);
      expect(found!.enabled).toBe(true);
    });
  });

  describe('countByAgentId', () => {
    it('should count jobs for a specific agent', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      await model.create({ agentId, cronPattern: '0 * * * *', content: 'Count 1' });
      await model.create({ agentId, cronPattern: '30 * * * *', content: 'Count 2' });

      const count = await model.countByAgentId(agentId);
      expect(count).toBe(2);
    });

    it('should return 0 when agent has no jobs', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      const count = await model.countByAgentId(agentId);
      expect(count).toBe(0);
    });

    it('should only count jobs for the current user', async () => {
      const model1 = new AgentCronJobModel(serverDB, userId);
      await model1.create({ agentId, cronPattern: '0 * * * *', content: 'User 1' });

      const model2 = new AgentCronJobModel(serverDB, userId2);
      const count = await model2.countByAgentId(agentId);
      expect(count).toBe(0);
    });
  });

  describe('findWithPagination', () => {
    it('should return paginated results with total', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      for (let i = 0; i < 5; i++) {
        await model.create({
          agentId,
          cronPattern: '0 * * * *',
          content: `Page job ${i}`,
        });
      }

      const result = await model.findWithPagination({ limit: 2, offset: 0 });
      expect(result.total).toBe(5);
      expect(result.jobs).toHaveLength(2);
    });

    it('should support offset for pagination', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      for (let i = 0; i < 5; i++) {
        await model.create({
          agentId,
          cronPattern: '0 * * * *',
          content: `Offset job ${i}`,
        });
      }

      const page1 = await model.findWithPagination({ limit: 2, offset: 0 });
      const page2 = await model.findWithPagination({ limit: 2, offset: 2 });

      expect(page1.jobs).toHaveLength(2);
      expect(page2.jobs).toHaveLength(2);
      // Jobs should be different between pages
      expect(page1.jobs[0].id).not.toBe(page2.jobs[0].id);
    });

    it('should filter by agentId', async () => {
      const model1 = new AgentCronJobModel(serverDB, userId);
      // Create another agent for the same user
      const [anotherAgent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Another Agent' })
        .returning();

      await model1.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Agent 1 job',
      });
      await model1.create({
        agentId: anotherAgent.id,
        cronPattern: '0 * * * *',
        content: 'Agent 2 job',
      });

      const result = await model1.findWithPagination({ agentId });
      expect(result.total).toBe(1);
      expect(result.jobs[0].content).toBe('Agent 1 job');
    });

    it('should filter by enabled status', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Enabled paginated',
        enabled: true,
      });
      await model.create({
        agentId,
        cronPattern: '30 * * * *',
        content: 'Disabled paginated',
        enabled: false,
      });

      const enabledResult = await model.findWithPagination({ enabled: true });
      expect(enabledResult.total).toBe(1);
      expect(enabledResult.jobs[0].content).toBe('Enabled paginated');

      const disabledResult = await model.findWithPagination({ enabled: false });
      expect(disabledResult.total).toBe(1);
      expect(disabledResult.jobs[0].content).toBe('Disabled paginated');
    });

    it('should filter by both agentId and enabled', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      await model.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'Enabled for agent',
        enabled: true,
      });
      await model.create({
        agentId,
        cronPattern: '30 * * * *',
        content: 'Disabled for agent',
        enabled: false,
      });

      const result = await model.findWithPagination({ agentId, enabled: true });
      expect(result.total).toBe(1);
      expect(result.jobs[0].content).toBe('Enabled for agent');
    });

    it('should use default limit of 20', async () => {
      const model = new AgentCronJobModel(serverDB, userId);
      for (let i = 0; i < 3; i++) {
        await model.create({
          agentId,
          cronPattern: '0 * * * *',
          content: `Default limit job ${i}`,
        });
      }

      const result = await model.findWithPagination({});
      expect(result.total).toBe(3);
      expect(result.jobs).toHaveLength(3);
    });

    it('should only return jobs for the current user', async () => {
      const model1 = new AgentCronJobModel(serverDB, userId);
      await model1.create({
        agentId,
        cronPattern: '0 * * * *',
        content: 'User 1 paginated',
      });

      const model2 = new AgentCronJobModel(serverDB, userId2);
      await model2.create({
        agentId: agentId2,
        cronPattern: '0 * * * *',
        content: 'User 2 paginated',
      });

      const result1 = await model1.findWithPagination({});
      expect(result1.total).toBe(1);
      expect(result1.jobs[0].content).toBe('User 1 paginated');

      const result2 = await model2.findWithPagination({});
      expect(result2.total).toBe(1);
      expect(result2.jobs[0].content).toBe('User 2 paginated');
    });
  });
});
