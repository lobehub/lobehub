import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EVAL_TOOL_MOCK_BASE_URL_ENV } from '../mockService';
import {
  EVAL_INFRASTRUCTURE_TOOLS,
  getEvalAllowedTools,
  getEvalAttemptId,
  getEvalContextParams,
  getEvalMockConfig,
  resolveCaseToolForwarding,
  withResolvedToolForwarding,
} from '../utils';

const TRUSTED = 'https://bench-mock.example.com';

beforeEach(() => {
  vi.stubEnv(EVAL_TOOL_MOCK_BASE_URL_ENV, `${TRUSTED}/`);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getEvalContextParams', () => {
  it('passes nothing when the case has no env prompt and no clock', () => {
    expect(getEvalContextParams(undefined, {}, 'case-1')).toEqual({
      evalRuntime: { caseId: 'case-1', toolForwarding: undefined },
    });
  });

  it('carries the case clock and timezone without an env prompt', () => {
    expect(
      getEvalContextParams(undefined, { sessionDate: '2026-07-21', timezone: 'Asia/Shanghai' }),
    ).toEqual({ evalContext: { sessionDate: '2026-07-21', timezone: 'Asia/Shanghai' } });
  });

  it('merges dataset and case env prompts next to the clock', () => {
    expect(
      getEvalContextParams('Dataset note', { envPrompt: 'Case note', sessionDate: '2026-07-21' }),
    ).toEqual({
      evalContext: { envPrompt: 'Dataset note\n\nCase note', sessionDate: '2026-07-21' },
    });
  });

  it('carries the attempt id into the eval runtime', () => {
    expect(getEvalContextParams(undefined, {}, 'case-1', undefined, 'run_1_tpc_1')).toMatchObject({
      evalRuntime: { attemptId: 'run_1_tpc_1', caseId: 'case-1' },
    });
  });

  it('sets the tool allowlist only for a case that declares its agent tools', () => {
    expect(getEvalContextParams(undefined, { sessionDate: '2026-07-24' }, 'case-1')).toEqual({
      evalContext: { sessionDate: '2026-07-24' },
      evalRuntime: { caseId: 'case-1', toolForwarding: undefined },
    });
    expect(
      getEvalContextParams(undefined, { agent: { plugins: ['notion'] } }, 'case-1'),
    ).toMatchObject({
      evalRuntime: { allowedTools: ['notion', ...EVAL_INFRASTRUCTURE_TOOLS], caseId: 'case-1' },
    });
  });
});

describe('getEvalAllowedTools', () => {
  it('is undefined for a case without a declared tool list', () => {
    expect(getEvalAllowedTools(undefined)).toBeUndefined();
    expect(getEvalAllowedTools({ mock: { services: ['notion'] } })).toBeUndefined();
  });

  it('unions declared plugins, mocked services, forwarded tools and the infrastructure tools', () => {
    expect(
      getEvalAllowedTools({
        agent: { plugins: ['notion', 'lobe-web-browsing'] },
        mock: { services: ['notion', 'lobe-web-browsing'] },
        toolForwarding: { gmail: { endpoint: 'http://mock/exec' } },
      }),
    ).toEqual(['notion', 'lobe-web-browsing', 'gmail', ...EVAL_INFRASTRUCTURE_TOOLS]);
  });

  it('keeps only the infrastructure tools for a case that disables tools', () => {
    expect(getEvalAllowedTools({ agent: { plugins: [] } })).toEqual(EVAL_INFRASTRUCTURE_TOOLS);
  });
});

describe('getEvalAttemptId', () => {
  it('names a case attempt by run and topic, and a pass@k attempt by its thread too', () => {
    expect(getEvalAttemptId({ runId: 'run_1', topicId: 'tpc_1' })).toBe('run_1_tpc_1');
    expect(getEvalAttemptId({ runId: 'run_1', threadId: 'thr_1', topicId: 'tpc_1' })).toBe(
      'run_1_tpc_1_thr_1',
    );
    // Null stays out so a resumed topic attempt keeps the same id.
    expect(getEvalAttemptId({ runId: 'run_1', threadId: null, topicId: 'tpc_1' })).toBe(
      'run_1_tpc_1',
    );
  });
});

describe('resolveCaseToolForwarding', () => {
  const mock = { baseUrl: TRUSTED, dataset: 'bench30', timeoutMs: 30_000 };

  it('derives one endpoint per declared service on the trusted mock', () => {
    expect(
      resolveCaseToolForwarding({ mock: { services: ['twitter', 'cron-eval-mcp'] } }, mock, 'ds-1'),
    ).toEqual({
      'cron-eval-mcp': {
        endpoint: 'https://bench-mock.example.com/tool-exec/bench30/cron-eval-mcp/exec',
        timeoutMs: 30_000,
      },
      'twitter': {
        endpoint: 'https://bench-mock.example.com/tool-exec/bench30/twitter/exec',
        timeoutMs: 30_000,
      },
    });
  });

  it('never uses an endpoint stored with the case: explicit entries only add connectors and timeouts', () => {
    expect(
      resolveCaseToolForwarding(
        {
          mock: { services: ['twitter'] },
          toolForwarding: {
            github: { endpoint: 'https://evil.example.com/steal' },
            twitter: { endpoint: 'https://override.example.com/x', timeoutMs: 5000 },
          },
        },
        { baseUrl: TRUSTED },
        'benchmark-30-v26',
      ),
    ).toEqual({
      github: { endpoint: 'https://bench-mock.example.com/tool-exec/benchmark-30-v26/github/exec' },
      twitter: {
        endpoint: 'https://bench-mock.example.com/tool-exec/benchmark-30-v26/twitter/exec',
        timeoutMs: 5000,
      },
    });
  });

  it('is undefined for a case that forwards nothing', () => {
    expect(resolveCaseToolForwarding({}, mock, 'ds')).toBeUndefined();
    expect(resolveCaseToolForwarding(undefined, undefined, 'ds')).toBeUndefined();
  });

  it('refuses to run forwarded tools on a server without a mock, whatever the case stored', () => {
    expect(() =>
      resolveCaseToolForwarding({ mock: { services: ['twitter'] } }, undefined, 'ds'),
    ).toThrow('EVAL_TOOL_MOCK_BASE_URL');
    expect(() =>
      resolveCaseToolForwarding(
        { toolForwarding: { github: { endpoint: 'https://m.example.com/gh' } } },
        undefined,
        'ds',
      ),
    ).toThrow('EVAL_TOOL_MOCK_BASE_URL');
  });
});

describe('withResolvedToolForwarding', () => {
  it('drops a stored table that resolves to nothing instead of passing it through', () => {
    expect(withResolvedToolForwarding({ envPrompt: 'x' }, undefined, 'ds')).toEqual({
      envPrompt: 'x',
    });
  });
});

describe('getEvalMockConfig', () => {
  it('takes the address from the server and the presentation from benchmark, then dataset', () => {
    expect(
      getEvalMockConfig(
        {
          metadata: {
            mock: {
              baseUrl: 'https://evil.example.com',
              connectors: { gmail: { title: 'Gmail' } },
              dataset: 'v26',
              timeoutMs: 20_000,
            },
          },
        },
        { metadata: { mock: { baseUrl: 'https://also-evil.example.com', dataset: 'v27' } } },
      ),
    ).toEqual({
      baseUrl: TRUSTED,
      connectors: { gmail: { title: 'Gmail' } },
      dataset: 'v27',
      timeoutMs: 20_000,
    });
  });

  it('is configured for a benchmark that stores no mock at all', () => {
    expect(getEvalMockConfig({ metadata: { kind: 'lobe-bench' } }, null)).toEqual({
      baseUrl: TRUSTED,
    });
  });

  it('is undefined when the server has no mock, even if the benchmark stored an address', () => {
    vi.stubEnv(EVAL_TOOL_MOCK_BASE_URL_ENV, '');
    expect(
      getEvalMockConfig({ metadata: { mock: { baseUrl: 'https://evil.example.com' } } }, null),
    ).toBeUndefined();
  });
});
