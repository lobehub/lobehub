import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ControlsForm from '../ControlsForm';

interface TestAgentState {
  config: Record<string, unknown>;
  model: string;
  provider: string;
}

interface TestAiState {
  extendParams: string[];
}

const testState = vi.hoisted(() => ({
  agentState: {
    config: {},
    model: 'gpt-4',
    provider: 'openai',
  } as TestAgentState,
  aiState: {
    extendParams: ['enableReasoning'],
  } as TestAiState,
  setValues: vi.fn(),
  updateAgentChatConfig: vi.fn(),
}));

vi.mock('@lobehub/ui/form', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Form: () => <div data-testid="controls-form" />,
  useForm: () => ({ setValues: testState.setValues }),
  useWatch: vi.fn(() => undefined),
}));

vi.mock('react-i18next', () => {
  return {
    Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});

vi.mock('@/features/ChatInput/hooks/useAgentId', () => ({
  useAgentId: () => 'agent-1',
}));

vi.mock('@/features/ChatInput/hooks/useUpdateAgentConfig', () => ({
  useUpdateAgentConfig: () => ({ updateAgentChatConfig: testState.updateAgentChatConfig }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: <T,>(selector: (state: TestAgentState) => T) => selector(testState.agentState),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentModelById: () => (state: TestAgentState) => state.model,
    getAgentModelProviderById: () => (state: TestAgentState) => state.provider,
  },
  chatConfigByIdSelectors: {
    getChatConfigById: () => (state: TestAgentState) => state.config,
  },
}));

vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    modelExtendParams: () => (state: TestAiState) => state.extendParams,
  },
  useAiInfraStore: <T,>(selector: (state: TestAiState) => T) => selector(testState.aiState),
}));

describe('ControlsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.agentState = {
      config: {},
      model: 'gpt-4',
      provider: 'openai',
    };
    testState.aiState = {
      extendParams: ['enableReasoning'],
    };
  });

  it('should sync legacy thinking values into mounted form without persisting them', () => {
    testState.agentState.config = {
      thinking: 'disabled',
    };

    const { unmount } = render(<ControlsForm model="gpt-4" provider="openai" />);

    expect(testState.setValues).toHaveBeenLastCalledWith({
      enableReasoning: false,
      thinking: 'disabled',
    });
    expect(testState.updateAgentChatConfig).not.toHaveBeenCalled();

    unmount();

    testState.agentState.config = {
      thinking: 'enabled',
    };

    render(<ControlsForm model="gpt-4" provider="openai" />);

    expect(testState.setValues).toHaveBeenLastCalledWith({
      enableReasoning: true,
      thinking: 'enabled',
    });
    expect(testState.updateAgentChatConfig).not.toHaveBeenCalled();
  });

  it('should show model adaptive thinking default without persisting it', () => {
    testState.aiState.extendParams = ['enableAdaptiveThinking'];

    render(<ControlsForm model="claude-sonnet-5" provider="lobehub" />);

    expect(testState.setValues).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enableAdaptiveThinking: true,
      }),
    );
    expect(testState.updateAgentChatConfig).not.toHaveBeenCalled();
  });

  it('should preserve explicit adaptive thinking override', () => {
    testState.agentState.config = {
      enableAdaptiveThinking: false,
    };
    testState.aiState.extendParams = ['enableAdaptiveThinking'];

    render(<ControlsForm model="claude-sonnet-5" provider="lobehub" />);

    expect(testState.setValues).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enableAdaptiveThinking: false,
      }),
    );
  });
});
