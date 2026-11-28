import { ChatErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveAutomationPauseCause } from './pauseCause';

describe('resolveAutomationPauseCause', () => {
  it.each([
    ChatErrorType.FreePlanLimit,
    ChatErrorType.InsufficientBudgetForAgentRunFee,
    ChatErrorType.InsufficientBudgetForModel,
    ChatErrorType.SubscriptionPlanLimit,
  ])('reads %s as out of usage', (errorCode) => {
    expect(resolveAutomationPauseCause({ errorCode })).toBe('insufficientBudget');
  });

  it('reads the Forbidden refusal classified as quota as a paid-only model', () => {
    expect(resolveAutomationPauseCause({ errorCategory: 'quota', errorCode: '403' })).toBe(
      'paidModelRequired',
    );
  });

  it.each([
    [{ errorCode: '403' }],
    [{ errorCategory: 'auth', errorCode: '403' }],
    [{ errorCategory: 'quota', errorCode: 'InsufficientQuota' }],
    [{ errorCode: 'ProviderNetworkError' }],
    [{ errorCategory: 'quota' }],
    [{}],
  ])('leaves other failures without a cause: %o', (input) => {
    expect(resolveAutomationPauseCause(input)).toBeUndefined();
  });
});
