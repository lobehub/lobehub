import { describe, expect, it } from 'vitest';

import { AgentRuntimeErrorType } from '../types/error';
import { getRuntimeErrorI18nKey } from './i18nKey';

describe('getRuntimeErrorI18nKey', () => {
  it('routes registered runtime codes to the modelRuntime namespace', () => {
    expect(getRuntimeErrorI18nKey(AgentRuntimeErrorType.InvalidProviderAPIKey)).toEqual({
      key: 'InvalidProviderAPIKey',
      ns: 'modelRuntime',
    });
  });

  it('canonicalises deprecated aliases so the lookup hits an existing key', () => {
    expect(getRuntimeErrorI18nKey('PipelineError')).toEqual({
      key: AgentRuntimeErrorType.ContextEnginePipelineError,
      ns: 'modelRuntime',
    });
    expect(getRuntimeErrorI18nKey(AgentRuntimeErrorType.QuotaLimitReached)).toEqual({
      key: AgentRuntimeErrorType.RateLimitExceeded,
      ns: 'modelRuntime',
    });
  });

  it('keeps HTTP statuses and app-only codes on the legacy error namespace', () => {
    expect(getRuntimeErrorI18nKey(401)).toEqual({ key: 'response.401', ns: 'error' });
    expect(getRuntimeErrorI18nKey('InvalidAccessCode')).toEqual({
      key: 'response.InvalidAccessCode',
      ns: 'error',
    });
  });
});
