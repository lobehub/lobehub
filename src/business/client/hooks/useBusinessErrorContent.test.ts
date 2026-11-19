import { AgentRuntimeErrorType } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MEMBER_BUDGET_TYPE } from './memberBudgetError';
import useBusinessErrorContent from './useBusinessErrorContent';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('useBusinessErrorContent', () => {
  it('explains a used-up member budget instead of the API key quota copy', () => {
    const { result } = renderHook(() =>
      useBusinessErrorContent({
        body: { budget: { budgetTypeAtError: MEMBER_BUDGET_TYPE }, error: { maxBudget: 10 } },
        message: 'User budget exceeded',
        type: AgentRuntimeErrorType.InsufficientQuota,
      }),
    );

    expect(result.current).toEqual({ message: 'memberBudgetExceeded' });
  });

  it('keeps the default copy for a provider key that ran out of quota', () => {
    const { result } = renderHook(() =>
      useBusinessErrorContent({
        body: { error: { message: 'insufficient_quota' } },
        message: 'insufficient_quota',
        type: AgentRuntimeErrorType.InsufficientQuota,
      }),
    );

    expect(result.current).toEqual({});
  });

  it('ignores a member budget tag on other error types', () => {
    const { result } = renderHook(() =>
      useBusinessErrorContent({
        body: { budget: { budgetTypeAtError: MEMBER_BUDGET_TYPE } },
        message: 'boom',
        type: AgentRuntimeErrorType.AgentRuntimeError,
      }),
    );

    expect(result.current).toEqual({});
  });
});
