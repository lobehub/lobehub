// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock appEnv before importing QueueService
const mockAppEnv = {
  enableQueueAgentRuntime: false,
};

vi.mock('@/envs/app', () => ({
  appEnv: mockAppEnv,
}));

describe('QueueService', () => {
  beforeEach(() => {
    vi.resetModules();
    // Reset to default local mode
    mockAppEnv.enableQueueAgentRuntime = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Local Execution Mode (default)', () => {
    it('should return LocalQueueServiceImpl when enableQueueAgentRuntime is false', async () => {
      const { createQueueServiceModule, LocalQueueServiceImpl } = await import('../impls');
      const impl = createQueueServiceModule();
      expect(impl).toBeInstanceOf(LocalQueueServiceImpl);
    });

    it('should return true for isLocalExecution when in local mode', async () => {
      const { QueueService } = await import('../QueueService');
      const service = new QueueService();
      expect(service.isLocalExecution()).toBe(true);
    });

    it('should schedule message and return task ID in local mode', async () => {
      const { QueueService } = await import('../QueueService');
      const service = new QueueService();

      const taskId = await service.scheduleMessage({
        context: { phase: 'user_input' } as any,
        endpoint: 'http://test.com',
        operationId: 'test-op',
        priority: 'normal',
        stepIndex: 0,
      });

      expect(taskId).toMatch(/^local-test-op-0-\d+$/);
    });

    it('should schedule batch messages in local mode', async () => {
      const { QueueService } = await import('../QueueService');
      const service = new QueueService();

      const taskIds = await service.scheduleBatchMessages([
        {
          context: { phase: 'user_input' } as any,
          endpoint: 'http://test.com',
          operationId: 'test-op-1',
          priority: 'normal',
          stepIndex: 0,
        },
        {
          context: { phase: 'user_input' } as any,
          endpoint: 'http://test.com',
          operationId: 'test-op-2',
          priority: 'normal',
          stepIndex: 0,
        },
      ]);

      expect(taskIds).toHaveLength(2);
      expect(taskIds[0]).toMatch(/^local-test-op-1-0-\d+$/);
      expect(taskIds[1]).toMatch(/^local-test-op-2-0-\d+$/);
    });

    it('should handle cancelScheduledTask gracefully in local mode (no-op)', async () => {
      const { QueueService } = await import('../QueueService');
      const service = new QueueService();

      // Should not throw, just logs a warning
      await expect(service.cancelScheduledTask('task-123')).resolves.toBeUndefined();
    });

    it('should return queue stats in local mode', async () => {
      const { QueueService } = await import('../QueueService');
      const service = new QueueService();

      const stats = await service.getQueueStats();
      expect(stats).toEqual({
        completedCount: 0,
        failedCount: 0,
        pendingCount: 0,
        processingCount: 0,
      });
    });

    it('should return healthy status for healthCheck in local mode', async () => {
      const { QueueService } = await import('../QueueService');
      const service = new QueueService();

      const result = await service.healthCheck();
      expect(result).toEqual({
        healthy: true,
        message: 'Local queue service healthy, 0 pending executions',
      });
    });
  });

  describe('Queue Mode (AGENT_RUNTIME_MODE=queue)', () => {
    it('should throw error when QSTASH_TOKEN is not set', async () => {
      mockAppEnv.enableQueueAgentRuntime = true;
      delete process.env.QSTASH_TOKEN;

      const { createQueueServiceModule } = await import('../impls');

      expect(() => createQueueServiceModule()).toThrow(
        'QSTASH_TOKEN is required when AGENT_RUNTIME_MODE=queue',
      );
    });

    it('should create QStashQueueServiceImpl when QSTASH_TOKEN is set', async () => {
      mockAppEnv.enableQueueAgentRuntime = true;
      process.env.QSTASH_TOKEN = 'test-qstash-token';

      const { createQueueServiceModule } = await import('../impls');
      const impl = createQueueServiceModule();

      expect(impl).not.toBeNull();
      expect(impl?.constructor.name).toBe('QStashQueueServiceImpl');

      // Cleanup
      delete process.env.QSTASH_TOKEN;
    });

    it('should return false for isLocalExecution when in queue mode', async () => {
      mockAppEnv.enableQueueAgentRuntime = true;
      process.env.QSTASH_TOKEN = 'test-qstash-token';

      const { QueueService } = await import('../QueueService');
      const service = new QueueService();

      expect(service.isLocalExecution()).toBe(false);

      // Cleanup
      delete process.env.QSTASH_TOKEN;
    });
  });

  describe('isQueueAgentRuntimeEnabled', () => {
    it('should return false when enableQueueAgentRuntime is false', async () => {
      mockAppEnv.enableQueueAgentRuntime = false;
      const { isQueueAgentRuntimeEnabled } = await import('../impls');
      expect(isQueueAgentRuntimeEnabled()).toBe(false);
    });

    it('should return true when enableQueueAgentRuntime is true', async () => {
      mockAppEnv.enableQueueAgentRuntime = true;
      const { isQueueAgentRuntimeEnabled } = await import('../impls');
      expect(isQueueAgentRuntimeEnabled()).toBe(true);
    });
  });

  describe('calculateDelay', () => {
    it('should return base delay for high priority', async () => {
      const { QueueService } = await import('../QueueService');
      const delay = QueueService.calculateDelay({
        hasErrors: false,
        hasToolCalls: false,
        priority: 'high',
        stepIndex: 0,
      });
      expect(delay).toBe(200);
    });

    it('should return base delay for normal priority', async () => {
      const { QueueService } = await import('../QueueService');
      const delay = QueueService.calculateDelay({
        hasErrors: false,
        hasToolCalls: false,
        priority: 'normal',
        stepIndex: 0,
      });
      expect(delay).toBe(1000);
    });

    it('should return base delay for low priority', async () => {
      const { QueueService } = await import('../QueueService');
      const delay = QueueService.calculateDelay({
        hasErrors: false,
        hasToolCalls: false,
        priority: 'low',
        stepIndex: 0,
      });
      expect(delay).toBe(5000);
    });

    it('should add delay for tool calls', async () => {
      const { QueueService } = await import('../QueueService');
      const delay = QueueService.calculateDelay({
        hasErrors: false,
        hasToolCalls: true,
        priority: 'normal',
        stepIndex: 0,
      });
      expect(delay).toBe(2000); // 1000 base + 1000 for tool calls
    });

    it('should add exponential backoff for errors', async () => {
      const { QueueService } = await import('../QueueService');

      const delay1 = QueueService.calculateDelay({
        hasErrors: true,
        hasToolCalls: false,
        priority: 'normal',
        stepIndex: 1,
      });
      expect(delay1).toBe(2000); // 1000 base + 1000 * 1

      const delay5 = QueueService.calculateDelay({
        hasErrors: true,
        hasToolCalls: false,
        priority: 'normal',
        stepIndex: 5,
      });
      expect(delay5).toBe(6000); // 1000 base + 1000 * 5

      const delay15 = QueueService.calculateDelay({
        hasErrors: true,
        hasToolCalls: false,
        priority: 'normal',
        stepIndex: 15,
      });
      expect(delay15).toBe(11000); // 1000 base + 10000 (max)
    });

    it('should combine tool calls and error delays', async () => {
      const { QueueService } = await import('../QueueService');
      const delay = QueueService.calculateDelay({
        hasErrors: true,
        hasToolCalls: true,
        priority: 'high',
        stepIndex: 2,
      });
      expect(delay).toBe(3200); // 200 base + 1000 for tools + 2000 for errors
    });
  });
});
