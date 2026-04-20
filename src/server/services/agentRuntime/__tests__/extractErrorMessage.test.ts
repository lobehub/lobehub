// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { AgentRuntimeService } from '../AgentRuntimeService';

// Mock all heavy dependencies to isolate extractErrorMessage logic
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'http://localhost:3010' } }));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@/server/modules/AgentRuntime', () => ({
  AgentRuntimeCoordinator: vi.fn().mockImplementation(() => ({})),
  createStreamEventManager: vi.fn(() => ({})),
}));
vi.mock('@/server/modules/AgentRuntime/RuntimeExecutors', () => ({
  createRuntimeExecutors: vi.fn(() => ({})),
}));
vi.mock('@/server/services/mcp', () => ({ mcpService: {} }));
vi.mock('@/server/services/queue', () => ({
  QueueService: vi.fn().mockImplementation(() => ({
    getImpl: vi.fn(() => ({})),
    scheduleMessage: vi.fn(),
  })),
}));
vi.mock('@/server/services/queue/impls', () => ({
  LocalQueueServiceImpl: class {},
}));
vi.mock('@/server/services/toolExecution', () => ({
  ToolExecutionService: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@/server/services/toolExecution/builtin', () => ({
  BuiltinToolsExecutor: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@lobechat/builtin-tools/dynamicInterventionAudits', () => ({
  dynamicInterventionAudits: [],
}));

describe('AgentRuntimeService.extractErrorMessage', () => {
  const createService = () => {
    return new AgentRuntimeService({} as any, 'user-1', { queueService: null });
  };

  it('should extract message from ChatCompletionErrorPayload (InsufficientBudgetForModel)', () => {
    const service = createService();
    const error = {
      error: { message: 'Budget exceeded' },
      errorType: 'InsufficientBudgetForModel',
      provider: 'lobehub',
      _responseBody: { provider: 'lobehub' },
    };

    const result = (service as any).extractErrorMessage(error);
    expect(result).toBe('Budget exceeded');
  });

  it('should extract message from ChatCompletionErrorPayload (InvalidProviderAPIKey)', () => {
    const service = createService();
    const error = {
      endpoint: 'https://cdn.example.com/v1',
      error: {
        code: '',
        error: { code: '', message: '无效的令牌', type: 'new_api_error' },
        message: '无效的令牌',
        status: 401,
        type: 'new_api_error',
      },
      errorType: 'InvalidProviderAPIKey',
      provider: 'openai',
    };

    const result = (service as any).extractErrorMessage(error);
    expect(result).toBe('无效的令牌');
  });

  it('should extract message from formatted ChatMessageError with body.error.message', () => {
    const service = createService();
    const error = {
      body: { error: { message: 'Rate limit exceeded' } },
      message: 'InvalidProviderAPIKey',
      type: 'InvalidProviderAPIKey',
    };

    const result = (service as any).extractErrorMessage(error);
    expect(result).toBe('Rate limit exceeded');
  });

  it('should extract message from ChatMessageError with body.message', () => {
    const service = createService();
    const error = {
      body: { message: 'Something went wrong' },
      message: 'error',
      type: 'InternalServerError',
    };

    const result = (service as any).extractErrorMessage(error);
    expect(result).toBe('Something went wrong');
  });

  it('should fallback to error.message when body is absent', () => {
    const service = createService();
    const error = { message: 'Connection timeout', type: 'NetworkError' };

    const result = (service as any).extractErrorMessage(error);
    expect(result).toBe('Connection timeout');
  });

  it('should fallback to errorType when message is "error"', () => {
    const service = createService();
    const error = { message: 'error', errorType: 'InsufficientBudgetForModel' };

    const result = (service as any).extractErrorMessage(error);
    expect(result).toBe('InsufficientBudgetForModel');
  });

  it('should return undefined for null/undefined', () => {
    const service = createService();
    expect((service as any).extractErrorMessage(null)).toBeUndefined();
    expect((service as any).extractErrorMessage(undefined)).toBeUndefined();
  });

  it('should never return [object Object] for nested error objects', () => {
    const service = createService();
    const error = {
      error: { message: 'Budget exceeded' },
      errorType: 'InsufficientBudgetForModel',
      provider: 'lobehub',
      _responseBody: { provider: 'lobehub' },
    };

    const result = (service as any).extractErrorMessage(error);
    expect(result).not.toBe('[object Object]');
    expect(typeof result).toBe('string');
    expect(result).toBe('Budget exceeded');
  });
});
