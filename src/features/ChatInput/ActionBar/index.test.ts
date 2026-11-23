/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_FEATURE_FLAGS, mapFeatureFlagsEnvToState } from '@/config/featureFlags';

import { filterChatOnlyActions } from './filterChatOnlyActions';
import ContextWindow from './Token';
import Token from './Token/TokenTag';

interface ModelPin {
  model: string;
  provider: string;
}

interface EnabledAiModel extends ModelPin {
  contextWindowTokens?: number;
}

const tokenMocks = vi.hoisted(() => ({
  agentId: 'agent-1',
  agentModel: { model: 'agent-model', provider: 'agent-provider' } as ModelPin,
  enabledAiModels: [] as { contextWindowTokens?: number; id: string; providerId: string }[],
  featureFlags: {} as Record<string, boolean | undefined>,
  topicModel: undefined as ModelPin | undefined,
  useTokenBreakdown: vi.fn(),
}));

// Store boundary: the real `aiModelSelectors` run against these states. `useEffectiveModel` reads
// the composer's own store (covered by its own test); here it resolves the topic pin over the agent default.
vi.mock('../hooks/useAgentId', () => ({
  useAgentId: () => tokenMocks.agentId,
}));

vi.mock('../hooks/useEffectiveModel', () => ({
  useEffectiveModel: () => tokenMocks.topicModel ?? tokenMocks.agentModel,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: object) => unknown) =>
    selector({
      activeAgentId: tokenMocks.agentId,
      agentMap: {
        [tokenMocks.agentId]: {
          model: tokenMocks.agentModel.model,
          provider: tokenMocks.agentModel.provider,
        },
      },
    }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: object) => unknown) =>
    selector({
      activeTopicId: tokenMocks.topicModel ? 'topic-1' : undefined,
      topicDataMap: {},
      topicDetailMap: tokenMocks.topicModel
        ? {
            'topic-1': {
              id: 'topic-1',
              model: tokenMocks.topicModel.model,
              provider: tokenMocks.topicModel.provider,
            },
          }
        : {},
    }),
}));

vi.mock('@/store/aiInfra', async () => ({
  aiModelSelectors: (await import('@/store/aiInfra/selectors')).aiModelSelectors,
  useAiInfraStore: (selector: (state: object) => unknown) =>
    selector({ enabledAiModels: tokenMocks.enabledAiModels }),
}));

vi.mock('@/store/serverConfig', async () => ({
  featureFlagsSelectors: (await import('@/store/serverConfig/selectors')).featureFlagsSelectors,
  useServerConfigStore: (
    selector: (state: { featureFlags: Record<string, boolean | undefined> }) => unknown,
  ) => selector({ featureFlags: tokenMocks.featureFlags }),
}));

vi.mock('@lobehub/ui/chat', () => ({
  TokenTag: ({ value }: { value: number }) =>
    createElement('div', { 'data-testid': 'token-tag' }, value),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: object) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: { config: () => ({ isDevMode: true }) },
}));

vi.mock('./components/ActionPopover', () => ({
  default: ({ children, content }: { children?: ReactNode; content?: ReactNode }) =>
    createElement('div', {}, children, content),
}));

vi.mock('./Token/TokenProgress', () => ({
  default: ({ data }: { data: { id: string; value: number }[] }) =>
    createElement(
      'div',
      { 'data-testid': `token-progress-${data[0].id}` },
      data.map(({ id, value }) => `${id}:${value}`).join(','),
    ),
}));

vi.mock('./Token/useTokenBreakdown', () => ({
  useTokenBreakdown: tokenMocks.useTokenBreakdown,
}));

const setEnabledModels = (...models: EnabledAiModel[]) => {
  tokenMocks.enabledAiModels = models.map(({ contextWindowTokens, model, provider }) => ({
    contextWindowTokens,
    id: model,
    providerId: provider,
  }));
};

beforeEach(() => {
  tokenMocks.featureFlags = mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS);
  tokenMocks.agentId = 'agent-1';
  tokenMocks.agentModel = { model: 'agent-model', provider: 'agent-provider' };
  tokenMocks.topicModel = undefined;
  setEnabledModels({ contextWindowTokens: 8000, model: 'agent-model', provider: 'agent-provider' });
  tokenMocks.useTokenBreakdown.mockReset();
});

describe('filterChatOnlyActions', () => {
  it('keeps runtime mode, attachments, formatting, and chat operations while hiding configuration actions', () => {
    expect(
      filterChatOnlyActions([
        'agentMode',
        'model',
        'search',
        'memory',
        'fileUpload',
        'tools',
        'voiceDictation',
        '---',
        ['typo', 'params', 'clear'],
      ]),
    ).toEqual(['agentMode', 'model', 'fileUpload', 'voiceDictation', '---', ['typo', 'clear']]);
  });

  it('keeps the model chip for chat-only members', () => {
    expect(filterChatOnlyActions(['model', 'plus'])).toEqual(['model', 'plus']);
  });
});

describe('Context window token', () => {
  const breakdown = {
    chatsToken: 3000,
    historySummaryToken: 500,
    maxTokens: 8000,
    systemRoleToken: 1500,
    toolsToken: 1000,
    totalToken: 6000,
  };

  it('hides the entire counter in developer mode by default', () => {
    tokenMocks.useTokenBreakdown.mockReturnValue(breakdown);
    render(createElement(ContextWindow));
    expect(screen.queryByTestId('token-tag')).not.toBeInTheDocument();
    expect(tokenMocks.useTokenBreakdown).not.toHaveBeenCalled();
  });

  it('hides the token tag when disabled and restores it when enabled', async () => {
    tokenMocks.useTokenBreakdown.mockReturnValue(breakdown);
    tokenMocks.featureFlags = mapFeatureFlagsEnvToState({
      member_token_visible: true,
      token_counter: true,
    });
    const { rerender } = render(createElement(ContextWindow));

    expect(await screen.findByTestId('token-tag')).toHaveTextContent('6000');

    tokenMocks.featureFlags = mapFeatureFlagsEnvToState({
      member_token_visible: true,
      token_counter: false,
    });
    rerender(createElement(ContextWindow));
    expect(screen.queryByTestId('token-tag')).not.toBeInTheDocument();

    tokenMocks.featureFlags = mapFeatureFlagsEnvToState({
      member_token_visible: true,
      token_counter: true,
    });
    rerender(createElement(ContextWindow));
    expect(await screen.findByTestId('token-tag')).toHaveTextContent('6000');
  });

  it('shows the token tag only for users in the token counter allowlist', async () => {
    tokenMocks.useTokenBreakdown.mockReturnValue(breakdown);
    const config = { member_token_visible: true, token_counter: ['user-123'] };
    tokenMocks.featureFlags = mapFeatureFlagsEnvToState(config, 'user-123');
    const { rerender } = render(createElement(ContextWindow));

    expect(await screen.findByTestId('token-tag')).toHaveTextContent('6000');

    tokenMocks.featureFlags = mapFeatureFlagsEnvToState(config, 'user-456');
    rerender(createElement(ContextWindow));
    expect(screen.queryByTestId('token-tag')).not.toBeInTheDocument();
  });

  it('keeps the token tag hidden for models without a context window', () => {
    tokenMocks.featureFlags = mapFeatureFlagsEnvToState({
      member_token_visible: true,
      token_counter: true,
    });
    setEnabledModels({ model: 'agent-model', provider: 'agent-provider' });
    tokenMocks.useTokenBreakdown.mockReturnValue(breakdown);

    render(createElement(ContextWindow));

    expect(screen.queryByTestId('token-tag')).not.toBeInTheDocument();
  });

  it('shows the token tag when the topic pinned model has a context window but the agent default does not', async () => {
    tokenMocks.featureFlags = mapFeatureFlagsEnvToState({
      member_token_visible: true,
      token_counter: true,
    });
    tokenMocks.topicModel = { model: 'topic-model', provider: 'topic-provider' };
    setEnabledModels(
      { model: 'agent-model', provider: 'agent-provider' },
      { contextWindowTokens: 16_000, model: 'topic-model', provider: 'topic-provider' },
    );
    tokenMocks.useTokenBreakdown.mockReturnValue(breakdown);

    render(createElement(ContextWindow));

    expect(await screen.findByTestId('token-tag')).toHaveTextContent('6000');
  });

  it('hides the token tag when the agent default has a context window but the topic pinned model does not', () => {
    tokenMocks.featureFlags = mapFeatureFlagsEnvToState({
      member_token_visible: true,
      token_counter: true,
    });
    tokenMocks.topicModel = { model: 'topic-model', provider: 'topic-provider' };
    setEnabledModels(
      { contextWindowTokens: 8000, model: 'agent-model', provider: 'agent-provider' },
      { model: 'topic-model', provider: 'topic-provider' },
    );
    tokenMocks.useTokenBreakdown.mockReturnValue(breakdown);

    render(createElement(ContextWindow));

    expect(screen.queryByTestId('token-tag')).not.toBeInTheDocument();
  });

  it('reuses the settled tag breakdown when rendering details', () => {
    tokenMocks.useTokenBreakdown
      .mockReturnValueOnce({
        chatsToken: 3000,
        historySummaryToken: 500,
        maxTokens: 8000,
        systemRoleToken: 1500,
        toolsToken: 1000,
        totalToken: 6000,
      })
      .mockReturnValue({
        chatsToken: 0,
        historySummaryToken: 0,
        maxTokens: 8000,
        systemRoleToken: 0,
        toolsToken: 0,
        totalToken: 0,
      });

    render(createElement(Token));

    expect(tokenMocks.useTokenBreakdown).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('token-tag')).toHaveTextContent('6000');
    expect(screen.getByTestId('token-progress-used')).toHaveTextContent('used:6000,rest:2000');
  });
});
