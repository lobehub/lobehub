import {
  type AgentTemplate,
  MarketplaceCategory,
} from '@lobechat/builtin-tool-web-onboarding/agentMarketplace';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { peekOnboardingCallbackUrl, stashOnboardingCallbackUrl } from '@/utils/onboardingRedirect';

import AgentPickerStep from './index';

const navigate = vi.fn();
const finishOnboarding = vi.fn().mockResolvedValue(undefined);
const installMarketplaceAgents = vi.fn().mockResolvedValue({
  installedAgentIds: [],
  skippedAgentIds: [],
  summaries: [],
});
const metrics = vi.hoisted(() => ({
  trackOnboardingCompleted: vi.fn(),
  trackOnboardingMarketplacePicked: vi.fn(),
  trackOnboardingMarketplaceShown: vi.fn(),
  trackOnboardingStepCompleted: vi.fn(),
}));

const templates: AgentTemplate[] = [
  {
    avatar: '🤖',
    category: MarketplaceCategory.Engineering,
    description: 'Reviews pull requests',
    id: 't1',
    title: 'Code Reviewer',
  },
  {
    avatar: '✍️',
    category: MarketplaceCategory.ContentCreation,
    description: 'Drafts marketing copy',
    id: 't2',
    title: 'Copywriter',
  },
];

let swrReturn: { data: AgentTemplate[]; error?: unknown; isLoading: boolean } = {
  data: templates,
  error: undefined,
  isLoading: false,
};
let searchParams = new URLSearchParams();

vi.mock('swr', () => ({ default: () => swrReturn }));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useSearchParams: () => [searchParams],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
    t: (key: string) => key,
  }),
}));

vi.mock('../../components/LobeMessage', () => ({
  default: ({ sentences }: { sentences: string[] }) => <div>{sentences.join(' / ')}</div>,
}));

vi.mock('@/services/agentMarketplace', () => ({
  fetchOnboardingAgentTemplates: vi.fn(),
}));

vi.mock('@/services/installMarketplaceAgents', () => ({
  installMarketplaceAgents: (...args: unknown[]) => installMarketplaceAgents(...args),
}));

vi.mock('@/services/onboardingMetrics', () => ({
  trackOnboardingCompleted: metrics.trackOnboardingCompleted,
  trackOnboardingMarketplacePicked: metrics.trackOnboardingMarketplacePicked,
  trackOnboardingMarketplaceShown: metrics.trackOnboardingMarketplaceShown,
  trackOnboardingStepCompleted: metrics.trackOnboardingStepCompleted,
}));

const userState = { finishOnboarding, user: { interests: [] as string[] } };
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: typeof userState) => unknown) => selector(userState),
}));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { interests: (s: typeof userState) => s.user?.interests ?? [] },
}));

beforeEach(() => {
  navigate.mockClear();
  finishOnboarding.mockClear();
  installMarketplaceAgents.mockClear();
  metrics.trackOnboardingCompleted.mockClear();
  metrics.trackOnboardingMarketplacePicked.mockClear();
  metrics.trackOnboardingMarketplaceShown.mockClear();
  metrics.trackOnboardingStepCompleted.mockClear();
  swrReturn = { data: templates, error: undefined, isLoading: false };
  searchParams = new URLSearchParams();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('AgentPickerStep', () => {
  it('renders an agent card for each template', () => {
    render(<AgentPickerStep onBack={vi.fn()} />);
    expect(screen.getByText('Code Reviewer')).toBeInTheDocument();
    expect(screen.getByText('Copywriter')).toBeInTheDocument();
  });

  it('installs the selected agents then finishes onboarding on Continue', async () => {
    render(<AgentPickerStep onBack={vi.fn()} />);

    fireEvent.click(screen.getByText('Code Reviewer'));
    const continueButton = screen.getByRole('button', { name: 'agentPicker.continue (1)' });
    fireEvent.click(continueButton);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    expect(installMarketplaceAgents).toHaveBeenCalledWith(['t1']);
    expect(finishOnboarding).toHaveBeenCalledTimes(1);
    expect(metrics.trackOnboardingStepCompleted).toHaveBeenCalledWith({
      action: 'continue',
      entry: 'classic',
      flow: 'classic',
      selectedCount: 1,
      step: 'agentpicker',
      stepIndex: 4,
    });
    expect(metrics.trackOnboardingCompleted).toHaveBeenCalledWith({
      flow: 'classic',
      targetUrl: '/',
    });
  });

  it('finishes onboarding without installing on Skip', async () => {
    render(<AgentPickerStep onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'agentPicker.skip' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    expect(finishOnboarding).toHaveBeenCalledTimes(1);
    expect(installMarketplaceAgents).not.toHaveBeenCalled();
    expect(metrics.trackOnboardingStepCompleted).toHaveBeenCalledWith({
      action: 'skip',
      entry: 'classic',
      flow: 'classic',
      selectedCount: 0,
      step: 'agentpicker',
      stepIndex: 4,
    });
    expect(metrics.trackOnboardingCompleted).toHaveBeenCalledWith({
      flow: 'classic',
      targetUrl: '/',
    });
  });

  it('navigates to the stashed signup callbackUrl on finish and clears it', async () => {
    stashOnboardingCallbackUrl('?callbackUrl=%2Fagent%2Fabc%3Fmessage%3Dhi');
    render(<AgentPickerStep onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'agentPicker.skip' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/agent/abc?message=hi'));
    expect(metrics.trackOnboardingCompleted).toHaveBeenCalledWith({
      flow: 'classic',
      targetUrl: '/agent/abc?message=hi',
    });
    expect(peekOnboardingCallbackUrl()).toBeUndefined();
  });

  it('shows a Back button that calls onBack for a normal classic entry', () => {
    const onBack = vi.fn();
    render(<AgentPickerStep onBack={onBack} />);

    fireEvent.click(screen.getByRole('button', { name: 'back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('hides the Back button when entered via agent-onboarding skip', () => {
    searchParams = new URLSearchParams('entry=skip');
    render(<AgentPickerStep onBack={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'back' })).not.toBeInTheDocument();
  });

  it('attributes entry=skip completion to the agent flow', async () => {
    searchParams = new URLSearchParams('entry=skip');
    render(<AgentPickerStep onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'agentPicker.skip' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    expect(metrics.trackOnboardingStepCompleted).toHaveBeenCalledWith({
      action: 'skip',
      entry: 'agent_skip',
      flow: 'agent',
      selectedCount: 0,
      step: 'agentpicker',
      stepIndex: 4,
    });
    expect(metrics.trackOnboardingCompleted).toHaveBeenCalledWith({
      flow: 'agent',
      targetUrl: '/',
    });
  });
});
