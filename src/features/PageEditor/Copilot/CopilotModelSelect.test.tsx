import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CopilotModelSelect from './CopilotModelSelect';

const mocks = vi.hoisted(() => ({
  aiInfra: {
    enabledImageModelList: [],
  },
  navigate: vi.fn(),
  updateAgentConfigById: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => null,
  Center: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/ChatInput/ActionBar/components/ActionPopover', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/Conversation', () => ({
  conversationSelectors: { agentId: (state: { agentId: string }) => state.agentId },
  useConversationStore: (selector: (state: { agentId: string }) => unknown) =>
    selector({ agentId: 'agent-1' }),
}));

vi.mock('@/features/ModelSwitchPanel', () => ({
  default: ({
    children,
    model,
    onModelChange,
    provider,
  }: {
    children: ReactNode;
    model?: string;
    onModelChange?: (params: { model: string; provider: string }) => void;
    provider?: string;
  }) => (
    <div>
      <output data-testid="selected-model">
        {provider}/{model}
      </output>
      {children}
      <button
        data-testid="change-model"
        type="button"
        onClick={() => onModelChange?.({ model: 'image-model', provider: 'zenmux' })}
      >
        Change model
      </button>
    </div>
  ),
}));

vi.mock('@/features/ModelSwitchPanel/components/ControlsForm', () => ({
  default: () => null,
}));

vi.mock(
  '@/routes/(main)/(create)/image/features/ConfigPanel/components/ModelSelect/ImageModelItem',
  () => ({ default: () => null }),
);

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      updateAgentConfigById: mocks.updateAgentConfigById,
    }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentModelById: () => () => 'chat-model',
    getAgentModelProviderById: () => () => 'openai',
  },
}));

vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    getEnabledModelById: () => () => undefined,
    isModelHasNonReasoningExtendParams: () => () => false,
  },
  aiProviderSelectors: {
    enabledImageModelList: (state: typeof mocks.aiInfra) => state.enabledImageModelList,
  },
  useAiInfraStore: (selector: (state: typeof mocks.aiInfra) => unknown) => selector(mocks.aiInfra),
}));

describe('CopilotModelSelect', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.updateAgentConfigById.mockReset();
    mocks.aiInfra.enabledImageModelList = [];
  });

  it('keeps an empty image selection controlled so choosing a model does not mutate Agent defaults', () => {
    render(<CopilotModelSelect mode="image" model={undefined} provider={undefined} />);

    expect(screen.getByTestId('selected-model')).toHaveTextContent('/');
    fireEvent.click(screen.getByTestId('change-model'));

    expect(mocks.updateAgentConfigById).not.toHaveBeenCalled();
  });
});
