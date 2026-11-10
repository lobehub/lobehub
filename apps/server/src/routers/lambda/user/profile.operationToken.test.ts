// @vitest-environment node
import { Plans } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getReferralStatus, getSubscriptionPlan } from '@/business/server/user';
import { MessageModel } from '@/database/models/message';
import { SessionModel } from '@/database/models/session';
import { UserModel } from '@/database/models/user';

import { userRouter } from '.';

vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after: vi.fn() }));
vi.mock('@/business/server/user', () => ({
  getReferralStatus: vi.fn(),
  getSubscriptionPlan: vi.fn(),
  onUserActivityForBusiness: vi.fn(),
}));
vi.mock('@/database/server', () => ({ serverDB: {} }));
vi.mock('@/database/models/message');
vi.mock('@/database/models/session');
vi.mock('@/database/models/user');
vi.mock('@/server/modules/KeyVaultsEncrypt');
vi.mock('@/server/modules/S3');
vi.mock('@/server/services/user');
vi.mock('@/server/services/understanding/service', () => ({
  createUnderstandingService: vi.fn(),
}));
vi.mock('@/server/services/taskRecommendation/service', () => ({
  createTaskRecommendationService: vi.fn(),
  TaskRecommendationNotFoundError: class extends Error {},
}));
vi.mock('@/server/workflows/onboardingUnderstanding', () => ({
  UnderstandingWorkflowUnavailableError: class extends Error {},
}));

const settings = {
  general: { responseLanguage: 'zh-CN' },
  keyVaults: { openai: { apiKey: 'sk-secret' } },
  market: { accessToken: 'market-token' },
};

describe('userRouter.getUserState with a run operation token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReferralStatus).mockResolvedValue(undefined);
    vi.mocked(getSubscriptionPlan).mockResolvedValue(Plans.Free);
    vi.mocked(UserModel).mockImplementation(function () {
      return {
        getUserSettings: vi.fn().mockResolvedValue(settings),
        getUserState: vi.fn().mockResolvedValue({ email: 'owner@example.com', settings }),
      } as any;
    });
    vi.mocked(MessageModel).mockImplementation(function () {
      return { countUpTo: vi.fn().mockResolvedValue(0) } as any;
    });
    vi.mocked(SessionModel).mockImplementation(function () {
      return { hasMoreThanN: vi.fn().mockResolvedValue(false) } as any;
    });
  });

  it('returns only the report language', async () => {
    // The acceptance CLI reads the response language through this route, and the
    // token sits in the run's environment where the agent can read it: no
    // credentials, and none of the creator's profile, plan or onboarding state.
    const state = await userRouter
      .createCaller({ heteroOperationScope: 'op_task_run', userId: 'operation-owner' } as any)
      .getUserState();

    expect(state).toEqual({
      preference: {},
      settings: { general: { responseLanguage: 'zh-CN' } },
      userId: 'operation-owner',
    });
    expect(getSubscriptionPlan).not.toHaveBeenCalled();
    expect(getReferralStatus).not.toHaveBeenCalled();
  });

  it('still returns the full state, credentials included, to a user session', async () => {
    const state = await userRouter
      .createCaller({ userId: 'operation-owner' } as any)
      .getUserState();

    expect(state.email).toBe('owner@example.com');
    expect(state.settings).toEqual(settings);
  });
});
