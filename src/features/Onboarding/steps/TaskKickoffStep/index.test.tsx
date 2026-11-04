import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TaskKickoffStep from './index';

const mocks = vi.hoisted(() => ({
  inboxAgentId: 'agt_inbox' as string | undefined,
  interests: ['coding'] as string[],
  navigate: vi.fn(),
  onCreated: vi.fn(),
  queueDraftForMainComposer: vi.fn(),
  recommendations: { mode: 'hidden' } as Record<string, unknown>,
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

vi.mock('../../components/LobeMessage', () => ({
  default: ({ sentences }: { sentences: string[] }) => <div>{sentences[0]}</div>,
}));

vi.mock('@/features/Conversation/composerDraftBus', () => ({
  queueDraftForMainComposer: mocks.queueDraftForMainComposer,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/features/RecommendTaskTemplates/useDailyBriefRecommendationsUI', () => ({
  useDailyBriefRecommendationsUI: () => mocks.recommendations,
}));

vi.mock('@/features/RecommendTaskTemplates/TaskTemplateCard', () => ({
  TaskTemplateCard: ({
    onCreated,
    template,
  }: {
    onCreated: (id: number) => void;
    template: { id: number; title: string };
  }) => (
    <button type="button" onClick={() => onCreated(template.id)}>
      card:{template.title}
    </button>
  ),
}));

vi.mock('@/features/RecommendTaskTemplates/TaskTemplateCardSkeleton', () => ({
  TaskTemplateCardSkeleton: () => <div>card-skeleton</div>,
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
  mocks.recommendations = { mode: 'hidden' };
  mocks.navigate.mockReset();
  mocks.onCreated.mockReset();
  mocks.queueDraftForMainComposer.mockReset();
  mocks.trackOnboardingStepCompleted.mockReset();
  mocks.trackOnboardingStepViewed.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('TaskKickoffStep', () => {
  it('tracks the view once', () => {
    const { rerender } = render(<TaskKickoffStep />);
    rerender(<TaskKickoffStep />);

    expect(mocks.trackOnboardingStepViewed).toHaveBeenCalledTimes(1);
    expect(mocks.trackOnboardingStepViewed).toHaveBeenCalledWith(STEP);
  });

  it('keeps start chat and skip available without suggestions', () => {
    render(<TaskKickoffStep />);

    expect(screen.getByText('taskKickoff.empty')).toBeTruthy();
    expect(screen.getByText('taskKickoff.startChat')).toBeTruthy();
    expect(screen.getByText('taskKickoff.skip')).toBeTruthy();
  });

  it('shows skeletons while suggestions load', () => {
    mocks.recommendations = { mode: 'skeleton', skeletonCount: 3 };
    render(<TaskKickoffStep />);

    expect(screen.getAllByText('card-skeleton')).toHaveLength(3);
    expect(screen.getByText('taskKickoff.startChat')).toBeTruthy();
  });

  it('queues an interests prompt into the inbox chat', () => {
    render(<TaskKickoffStep />);
    fireEvent.click(screen.getByText('taskKickoff.startChat'));

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

  it('falls back home when the inbox agent is unavailable', () => {
    mocks.inboxAgentId = undefined;
    render(<TaskKickoffStep />);
    fireEvent.click(screen.getByText('taskKickoff.startChat'));

    expect(mocks.queueDraftForMainComposer).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('tracks skip and goes home', () => {
    render(<TaskKickoffStep />);
    fireEvent.click(screen.getByText('taskKickoff.skip'));

    expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
    expect(mocks.trackOnboardingStepCompleted).toHaveBeenCalledWith({
      ...STEP,
      action: 'skipped',
      skipped: true,
    });
  });

  it('tracks a created template once and keeps the step leavable', () => {
    mocks.recommendations = {
      mode: 'cards',
      onCreated: mocks.onCreated,
      templates: [{ id: 7, title: 'Daily digest' }],
    };
    render(<TaskKickoffStep />);
    fireEvent.click(screen.getByText('card:Daily digest'));
    fireEvent.click(screen.getByText('taskKickoff.skip'));

    expect(mocks.onCreated).toHaveBeenCalledWith(7);
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
