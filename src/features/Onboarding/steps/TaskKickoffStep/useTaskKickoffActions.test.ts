import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskKickoffActions } from './useTaskKickoffActions';

const mocks = vi.hoisted(() => ({
  inboxAgentId: 'agt_inbox' as string | undefined,
  interests: ['coding'] as string[],
  navigate: vi.fn(),
  onRecommendationCreated: vi.fn(),
  queueDraftForMainComposer: vi.fn(),
  trackOnboardingStepCompleted: vi.fn(),
  trackOnboardingStepViewed: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

vi.mock('@/features/Conversation/composerDraftBus', () => ({
  queueDraftForMainComposer: mocks.queueDraftForMainComposer,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/services/onboardingMetrics', () => ({
  trackOnboardingStepCompleted: mocks.trackOnboardingStepCompleted,
  trackOnboardingStepViewed: mocks.trackOnboardingStepViewed,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: { inboxAgentId?: string }) => unknown) =>
    selector({ inboxAgentId: mocks.inboxAgentId }),
}));

vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: { inboxAgentId: (s: { inboxAgentId?: string }) => s.inboxAgentId },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: { interests: string[] }) => unknown) =>
    selector({ interests: mocks.interests }),
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { interests: (s: { interests: string[] }) => s.interests },
}));

const STEP = { flow: 'classic', step: 'taskkickoff', stepIndex: 5 };

beforeEach(() => {
  mocks.inboxAgentId = 'agt_inbox';
  mocks.interests = ['coding'];
  mocks.navigate.mockReset();
  mocks.onRecommendationCreated.mockReset();
  mocks.queueDraftForMainComposer.mockReset();
  mocks.trackOnboardingStepCompleted.mockReset();
  mocks.trackOnboardingStepViewed.mockReset();
});

describe('useTaskKickoffActions', () => {
  it('tracks the view once', () => {
    const { rerender } = renderHook(() => useTaskKickoffActions());
    rerender();

    expect(mocks.trackOnboardingStepViewed).toHaveBeenCalledTimes(1);
    expect(mocks.trackOnboardingStepViewed).toHaveBeenCalledWith(STEP);
  });

  it('queues an interests prompt into the inbox chat', () => {
    const { result } = renderHook(() => useTaskKickoffActions());
    expect(result.current.canStartChat).toBe(true);

    act(() => result.current.handleStartChat());

    expect(mocks.queueDraftForMainComposer).toHaveBeenCalledWith(
      `taskKickoff.prompt.withInterests:${JSON.stringify({ interests: 'interests.area.coding' })}`,
      { agentId: 'agt_inbox' },
    );
    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agt_inbox', { replace: true });
    expect(mocks.trackOnboardingStepCompleted).toHaveBeenCalledWith({
      ...STEP,
      action: 'chat_started',
    });
  });

  it('waits for the inbox agent instead of tracking a chat start', () => {
    mocks.inboxAgentId = undefined;
    const { result } = renderHook(() => useTaskKickoffActions());
    expect(result.current.canStartChat).toBe(false);

    act(() => result.current.handleStartChat());

    expect(mocks.queueDraftForMainComposer).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.trackOnboardingStepCompleted).not.toHaveBeenCalled();

    // Skip stays available, so the step is never a dead end.
    act(() => result.current.handleSkip());
    expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
    expect(mocks.trackOnboardingStepCompleted).toHaveBeenCalledWith({
      ...STEP,
      action: 'skipped',
      skipped: true,
    });
  });

  it('starts the chat once the inbox agent has loaded', () => {
    mocks.inboxAgentId = undefined;
    const { rerender, result } = renderHook(() => useTaskKickoffActions());

    mocks.inboxAgentId = 'agt_inbox';
    rerender();
    act(() => result.current.handleStartChat());

    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agt_inbox', { replace: true });
    expect(mocks.trackOnboardingStepCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.trackOnboardingStepCompleted).toHaveBeenCalledWith({
      ...STEP,
      action: 'chat_started',
    });
  });

  it('tracks skip and goes home', () => {
    const { result } = renderHook(() => useTaskKickoffActions());

    act(() => result.current.handleSkip());

    expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
    expect(mocks.trackOnboardingStepCompleted).toHaveBeenCalledWith({
      ...STEP,
      action: 'skipped',
      skipped: true,
    });
  });

  it('tracks a created template once and keeps the step leavable', () => {
    const { result } = renderHook(() =>
      useTaskKickoffActions({ onRecommendationCreated: mocks.onRecommendationCreated }),
    );

    act(() => result.current.handleCreated(7));
    act(() => result.current.handleSkip());

    expect(mocks.onRecommendationCreated).toHaveBeenCalledWith(7);
    // Skip still leaves the step, without a second completion event.
    expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
    expect(mocks.trackOnboardingStepCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.trackOnboardingStepCompleted).toHaveBeenCalledWith({
      ...STEP,
      action: 'template_created',
      templateId: 7,
    });
  });
});
