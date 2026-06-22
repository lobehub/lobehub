import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AgentModeNotice from './AgentModeNotice';

interface TestModel {
  abilities?: {
    functionCall?: boolean;
  };
  id: string;
  providerId: string;
}

const testState = vi.hoisted(() => ({
  agent: {
    agencyConfig: undefined as { heterogeneousProvider?: { type: string } } | undefined,
    enableAgentMode: true,
    model: 'gpt-4o',
    provider: 'openai',
  },
  aiInfra: {
    enabledAiModels: [] as TestModel[],
    isInitAiProviderRuntimeState: false,
  },
}));

type StoreSelector<T = unknown, S = Record<PropertyKey, unknown>> = (state: S) => T;

vi.mock('@lobehub/ui', () => ({
  Alert: ({ title }: { title: ReactNode }) => <div role="alert">{title}</div>,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ alert: 'alert' }),
  cx: (...classes: string[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/ChatInput/hooks/useAgentId', () => ({
  useAgentId: () => 'agent-id',
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: <T,>(selector: StoreSelector<T, typeof testState.agent>) =>
    selector(testState.agent),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentEnableModeById: () => (s: typeof testState.agent) => s.enableAgentMode,
    isAgentHeterogeneousById: () => (s: typeof testState.agent) =>
      Boolean(s.agencyConfig?.heterogeneousProvider),
    getAgentModelById: () => (s: typeof testState.agent) => s.model,
    getAgentModelProviderById: () => (s: typeof testState.agent) => s.provider,
  },
}));

vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    isModelSupportToolUse: (model: string, provider: string) => (s: typeof testState.aiInfra) =>
      s.enabledAiModels.find((item) => item.id === model && item.providerId === provider)?.abilities
        ?.functionCall || false,
  },
  aiProviderSelectors: {
    isInitAiProviderRuntimeState: (s: typeof testState.aiInfra) => s.isInitAiProviderRuntimeState,
  },
  useAiInfraStore: <T,>(selector: StoreSelector<T, typeof testState.aiInfra>) =>
    selector(testState.aiInfra),
}));

describe('AgentModeNotice', () => {
  beforeEach(() => {
    testState.agent.agencyConfig = undefined;
    testState.agent.enableAgentMode = true;
    testState.agent.model = 'gpt-4o';
    testState.agent.provider = 'openai';
    testState.aiInfra.enabledAiModels = [];
    testState.aiInfra.isInitAiProviderRuntimeState = false;
  });

  it('does not render before the model runtime config is ready', () => {
    render(<AgentModeNotice />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders after the model runtime config is ready when the model lacks tool use', () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledAiModels = [
      { abilities: { functionCall: false }, id: 'gpt-4o', providerId: 'openai' },
    ];

    render(<AgentModeNotice />);

    expect(screen.getByRole('alert')).toHaveTextContent('input.agentModeUnsupportedModel');
  });

  it('does not render when the ready model supports tool use', () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledAiModels = [
      { abilities: { functionCall: true }, id: 'gpt-4o', providerId: 'openai' },
    ];

    render(<AgentModeNotice />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not render when agent mode is disabled', () => {
    testState.agent.enableAgentMode = false;
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledAiModels = [
      { abilities: { functionCall: false }, id: 'gpt-4o', providerId: 'openai' },
    ];

    render(<AgentModeNotice />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not render for heterogeneous agents', () => {
    testState.agent.agencyConfig = { heterogeneousProvider: { type: 'codex' } };
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledAiModels = [
      { abilities: { functionCall: false }, id: 'gpt-4o', providerId: 'openai' },
    ];

    render(<AgentModeNotice />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
