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
  extendParamOptions?: {
    enableReasoning?: {
      defaultValue?: boolean;
      includeBudget?: boolean;
    };
  };
  extendParams: string[];
}

const testState = vi.hoisted(() => ({
  agentState: {
    config: {},
    model: 'gpt-4',
    provider: 'openai',
  } as TestAgentState,
  aiState: {
    extendParamOptions: undefined,
    extendParams: ['enableReasoning'],
  } as TestAiState,
  setFieldsValue: vi.fn(),
  updateAgentChatConfig: vi.fn(),
}));

vi.mock('@lobehub/ui', () => {
  const MockForm = () => <div data-testid="controls-form" />;
  MockForm.useForm = () => [{ setFieldsValue: testState.setFieldsValue }];

  return { Form: MockForm };
});

vi.mock('antd', () => {
  return {
    Form: { useWatch: vi.fn(() => undefined) },
    Grid: { useBreakpoint: () => ({ sm: true }) },
    Switch: () => <input type="checkbox" />,
  };
});

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
    modelExtendParamOptions: () => (state: TestAiState) => state.extendParamOptions,
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
      extendParamOptions: undefined,
      extendParams: ['enableReasoning'],
    };
  });

  it('should sync model default values into mounted form without persisting them', () => {
    const { rerender } = render(<ControlsForm model="gpt-4" provider="openai" />);

    expect(testState.setFieldsValue).toHaveBeenLastCalledWith({ enableReasoning: undefined });
    expect(testState.updateAgentChatConfig).not.toHaveBeenCalled();

    testState.aiState = {
      extendParamOptions: {
        enableReasoning: {
          defaultValue: true,
          includeBudget: false,
        },
      },
      extendParams: ['enableReasoning'],
    };

    rerender(<ControlsForm model="deepseek-v4-flash" provider="deepseek" />);

    expect(testState.setFieldsValue).toHaveBeenLastCalledWith({ enableReasoning: true });
    expect(testState.updateAgentChatConfig).not.toHaveBeenCalled();
  });
});
