// @vitest-environment node
import debug from 'debug';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentOperationModel } from '@/database/models/agentOperation';
import type * as WorkRegistrationModule from '@/server/services/workRegistration';

import { CompletionLifecycle, isSuccessLikeCompletionReason } from '.';

vi.mock('@/database/models/work', () => import('./testUtils').then((m) => m.workModelModule()));
vi.mock('@/database/models/topic', () => import('./testUtils').then((m) => m.topicModelModule()));
vi.mock('@/business/server/agent-run/agentInterventionReview', () =>
  import('./testUtils').then((m) => m.agentInterventionReviewModule()),
);
vi.mock('@/business/server/agent-run/notifyAgentRunCompleted', () =>
  import('./testUtils').then((m) => m.notifyAgentRunCompletedModule()),
);
vi.mock('../agentInterventionNotification', () =>
  import('./testUtils').then((m) => m.agentInterventionNotificationModule()),
);
vi.mock('@/server/services/workRegistration', async (importOriginal) => ({
  // Keep the real scope resolver: it is pure, and the share-visitor test
  // asserts the scope it derives reaches both the scan and the anchor lookup.
  ...(await importOriginal<typeof WorkRegistrationModule>()),
  registerWorksForOperation: vi.fn(),
}));

const buildLifecycle = () => new CompletionLifecycle({} as any, 'user-1');

describe('CompletionLifecycle.recordStart diagnostics', () => {
  let debugNamespaces: string;

  beforeEach(() => {
    debugNamespaces = debug.disable();
    debug.enable('lobe-server:completion-lifecycle');
  });

  afterEach(() => {
    debug.enable(debugNamespaces);
    vi.restoreAllMocks();
  });

  it.each([undefined, { _hooks: [] }])(
    'retains the database failure cause without persisted hooks: %j',
    async (metadata) => {
      vi.spyOn(AgentOperationModel.prototype, 'recordStart').mockRejectedValue(
        new Error('connection refused'),
      );
      const output = vi.spyOn(debug, 'log').mockImplementation(() => {});

      expect(await buildLifecycle().recordStart({ operationId: 'op-1', metadata })).toBe(false);
      expect(output.mock.calls.flat().join(' ')).toContain('connection refused');
    },
  );

  it('does not log database parameters containing hook credentials', async () => {
    const secret = 'synthetic-hook-authorization';
    vi.spyOn(AgentOperationModel.prototype, 'recordStart').mockRejectedValue(
      new Error(`Failed query; params: ${secret}`),
    );
    const output = vi.spyOn(debug, 'log').mockImplementation(() => {});

    expect(
      await buildLifecycle().recordStart({
        operationId: 'op-1',
        metadata: { _hooks: [{ webhook: { headers: { Authorization: secret } } }] },
      }),
    ).toBe(false);
    expect(output.mock.calls.flat().join(' ')).toContain('Failed to record operation start');
    expect(output.mock.calls.flat().join(' ')).not.toContain(secret);
  });
});

describe('isSuccessLikeCompletionReason', () => {
  // Regression: file-Work registration was gated on `reason === 'done'` alone,
  // silently skipping runs stopped by a step/cost cap even though the lifecycle
  // persists those as status='done' and recovers their assistant content.
  it('treats capped runs (max_steps / cost_limit) as successful completions', () => {
    expect(isSuccessLikeCompletionReason('done')).toBe(true);
    expect(isSuccessLikeCompletionReason('max_steps')).toBe(true);
    expect(isSuccessLikeCompletionReason('cost_limit')).toBe(true);
  });

  it('rejects non-success terminal and parked reasons', () => {
    expect(isSuccessLikeCompletionReason('error')).toBe(false);
    expect(isSuccessLikeCompletionReason('interrupted')).toBe(false);
    expect(isSuccessLikeCompletionReason('waiting_for_human')).toBe(false);
    expect(isSuccessLikeCompletionReason('waiting_for_async_tool')).toBe(false);
  });
});

describe('CompletionLifecycle.extractErrorMessage', () => {
  it('extracts message from ChatCompletionErrorPayload (InsufficientBudgetForModel)', () => {
    const lifecycle = buildLifecycle();
    const error = {
      _responseBody: { provider: 'lobehub' },
      error: { message: 'Budget exceeded' },
      errorType: 'InsufficientBudgetForModel',
      provider: 'lobehub',
    };

    expect(lifecycle.extractErrorMessage(error)).toBe('Budget exceeded');
  });

  it('extracts message from ChatCompletionErrorPayload (InvalidProviderAPIKey)', () => {
    const lifecycle = buildLifecycle();
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

    expect(lifecycle.extractErrorMessage(error)).toBe('无效的令牌');
  });

  it('extracts message from formatted ChatMessageError with body.error.message', () => {
    const lifecycle = buildLifecycle();
    const error = {
      body: { error: { message: 'Rate limit exceeded' } },
      message: 'InvalidProviderAPIKey',
      type: 'InvalidProviderAPIKey',
    };

    expect(lifecycle.extractErrorMessage(error)).toBe('Rate limit exceeded');
  });

  it('extracts message from ChatMessageError with body.message', () => {
    const lifecycle = buildLifecycle();
    const error = {
      body: { message: 'Something went wrong' },
      message: 'error',
      type: 'InternalServerError',
    };

    expect(lifecycle.extractErrorMessage(error)).toBe('Something went wrong');
  });

  it('falls back to error.message when body is absent', () => {
    const lifecycle = buildLifecycle();
    const error = { message: 'Connection timeout', type: 'NetworkError' };

    expect(lifecycle.extractErrorMessage(error)).toBe('Connection timeout');
  });

  it('falls back to errorType when message is "error"', () => {
    const lifecycle = buildLifecycle();
    const error = { errorType: 'InsufficientBudgetForModel', message: 'error' };

    expect(lifecycle.extractErrorMessage(error)).toBe('InsufficientBudgetForModel');
  });

  it('returns undefined for null/undefined', () => {
    const lifecycle = buildLifecycle();

    expect(lifecycle.extractErrorMessage(null)).toBeUndefined();
    expect(lifecycle.extractErrorMessage(undefined)).toBeUndefined();
  });

  it('never returns [object Object] for nested error objects', () => {
    const lifecycle = buildLifecycle();
    const error = {
      _responseBody: { provider: 'lobehub' },
      error: { message: 'Budget exceeded' },
      errorType: 'InsufficientBudgetForModel',
      provider: 'lobehub',
    };

    const result = lifecycle.extractErrorMessage(error);
    expect(result).not.toBe('[object Object]');
    expect(typeof result).toBe('string');
    expect(result).toBe('Budget exceeded');
  });
});
