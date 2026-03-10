import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ScheduledTaskExecutionRuntime } from './index';

describe('ScheduledTaskExecutionRuntime maxExecutions behavior', () => {
  const service = {
    deleteScheduledTask: vi.fn(),
    getScheduledTask: vi.fn(),
    listScheduledTasks: vi.fn(),
    setScheduledTask: vi.fn(),
  };

  const runtime = new ScheduledTaskExecutionRuntime({ service });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should default maxExecutions to null when omitted in set create path', async () => {
    service.setScheduledTask.mockResolvedValue({
      action: 'created',
      agentId: 'agt_1',
      cronPattern: '*/30 * * * *',
      enabled: true,
      jobId: 'cron_1',
      maxExecutions: null,
      timezone: 'UTC',
    });

    const result = await runtime.setScheduledTask({
      content: 'ping',
      cronPattern: '*/30 * * * *',
      name: 'heartbeat',
    });

    expect(result.success).toBe(false);

    const withContext = await runtime.setScheduledTask(
      {
        content: 'ping',
        cronPattern: '*/30 * * * *',
        name: 'heartbeat',
      },
      { agentId: 'agt_1' },
    );

    expect(withContext.success).toBe(true);
    expect(service.setScheduledTask).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agt_1', maxExecutions: null }),
    );
  });

  it('should accept maxExecutions = null in set create path', async () => {
    service.setScheduledTask.mockResolvedValue({
      action: 'created',
      agentId: 'agt_1',
      cronPattern: '*/30 * * * *',
      enabled: true,
      jobId: 'cron_2',
      maxExecutions: null,
      timezone: 'UTC',
    });

    const result = await runtime.setScheduledTask(
      {
        content: 'ping',
        cronPattern: '*/30 * * * *',
        maxExecutions: null,
        name: 'heartbeat',
      },
      { agentId: 'agt_1' },
    );

    expect(result.success).toBe(true);
    expect(service.setScheduledTask).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agt_1', maxExecutions: null }),
    );
  });

  it('should reject invalid maxExecutions input', async () => {
    const result = await runtime.setScheduledTask(
      {
        content: 'ping',
        cronPattern: '*/30 * * * *',
        maxExecutions: 0,
        name: 'heartbeat',
      },
      { agentId: 'agt_1' },
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain('maxExecutions');
  });

  it('should accept maxExecutions = null in set update path', async () => {
    service.setScheduledTask.mockResolvedValue({
      action: 'updated',
      agentId: 'agt_1',
      cronPattern: '*/30 * * * *',
      enabled: true,
      jobId: 'cron_3',
      maxExecutions: null,
      timezone: 'UTC',
    });

    const result = await runtime.setScheduledTask({
      jobId: 'cron_3',
      maxExecutions: null,
    });

    expect(result.success).toBe(true);
    expect(service.setScheduledTask).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'cron_3', maxExecutions: null }),
    );
  });

  it('should get scheduled task by jobId', async () => {
    service.getScheduledTask.mockResolvedValue({
      agentId: 'agt_1',
      content: 'ping',
      cronPattern: '*/30 * * * *',
      enabled: true,
      jobId: 'cron_4',
      maxExecutions: null,
      timezone: 'UTC',
    });

    const result = await runtime.getScheduledTask({ jobId: 'cron_4' });

    expect(result.success).toBe(true);
    expect(service.getScheduledTask).toHaveBeenCalledWith({ jobId: 'cron_4' });
  });

  it('should reject empty jobId in get', async () => {
    const result = await runtime.getScheduledTask({ jobId: '   ' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('jobId is required');
    expect(service.getScheduledTask).not.toHaveBeenCalled();
  });
});
