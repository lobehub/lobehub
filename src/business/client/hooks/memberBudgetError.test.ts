import { AgentRuntimeErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getBusinessErrorDetailsBody } from './memberBudgetError';

const memberBudget = { budgetTypeAtError: 'organization_member' };

describe('getBusinessErrorDetailsBody', () => {
  it.each([{ maxBudgetCredits: 735.001 }, { error: { maxBudgetCredits: 0 } }])(
    'hides the default provider and keeps the budget details (%j)',
    (amount) => {
      const details = { ...amount, budget: memberBudget, message: 'User budget exceeded' };
      const body = { ...details, provider: 'lobehub' };

      expect(
        getBusinessErrorDetailsBody({ body, type: AgentRuntimeErrorType.InsufficientQuota }),
      ).toEqual(details);
      expect(body.provider).toBe('lobehub');
    },
  );

  it.each([
    { budget: memberBudget, provider: 'openai' },
    { error: { message: 'insufficient_quota' }, provider: 'lobehub' },
  ])('keeps provider diagnostics for other quota errors (%j)', (body) => {
    expect(
      getBusinessErrorDetailsBody({ body, type: AgentRuntimeErrorType.InsufficientQuota }),
    ).toEqual(body);
  });
});
