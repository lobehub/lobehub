import { describe, expect, it } from 'vitest';

import {
  EVAL_INFRASTRUCTURE_TOOLS,
  getEvalAllowedTools,
  getEvalAttemptId,
  getEvalContextParams,
} from './utils';

describe('getEvalContextParams', () => {
  it('passes nothing when the case has no env prompt and no clock', () => {
    expect(getEvalContextParams(undefined, {}, 'case-1')).toEqual({
      evalRuntime: { caseId: 'case-1' },
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
      evalRuntime: { caseId: 'case-1' },
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
    expect(getEvalAllowedTools({ mock: { services: ['notion'] } })).toEqual([
      'notion',
      ...EVAL_INFRASTRUCTURE_TOOLS,
    ]);
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
