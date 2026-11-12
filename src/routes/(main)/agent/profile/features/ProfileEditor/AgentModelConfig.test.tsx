import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModelConfig } from './AgentModelConfig';

const testState = vi.hoisted(() => ({
  agent: {
    agentMap: {
      'agent-1': {
        agencyConfig: {
          modelSelectionPolicy: 'member' as const,
        },
        model: 'gpt-4',
        provider: 'openai',
        visibility: 'public' as 'private' | 'public',
        workspaceId: 'workspace-1',
      },
    } as Record<string, object>,
    updateAgentConfigById: vi.fn(),
  },
}));

vi.mock('@/features/ModelSelect', () => ({
  default: () => <div data-testid="model-select" />,
}));

vi.mock('@/features/ModelSelect/ReasoningEffortSelect', () => ({
  default: () => <div data-testid="reasoning-effort-select" />,
}));

vi.mock('./AgentConfigCard', () => ({
  AgentConfigCard: ({ children, title }: { children: ReactNode; title: string }) => (
    <div>
      <span>{title}</span>
      {children}
    </div>
  ),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof testState.agent) => unknown) =>
    selector(testState.agent),
}));

describe('AgentModelConfig', () => {
  beforeEach(() => {
    testState.agent.agentMap['agent-1'] = {
      agencyConfig: { modelSelectionPolicy: 'member' },
      model: 'gpt-4',
      provider: 'openai',
      visibility: 'public',
      workspaceId: 'workspace-1',
    };
  });

  it('renders the model and reasoning effort for a workspace agent', () => {
    render(<AgentModelConfig agentId="agent-1" />);

    expect(screen.getByText('settingAgent.modelPolicy.title')).toBeTruthy();
    expect(screen.getByTestId('model-select')).toBeTruthy();
    expect(screen.getByTestId('reasoning-effort-select')).toBeTruthy();
  });

  it('renders the same card for a personal agent', () => {
    testState.agent.agentMap['agent-1'] = {
      model: 'gpt-4',
      provider: 'openai',
      visibility: 'private',
    };

    render(<AgentModelConfig agentId="agent-1" />);

    expect(screen.getByText('settingAgent.modelPolicy.title')).toBeTruthy();
    expect(screen.getByTestId('model-select')).toBeTruthy();
    expect(screen.getByTestId('reasoning-effort-select')).toBeTruthy();
  });

  it('renders the model picker without a member-switch control — that moved to the Permission page', () => {
    testState.agent.agentMap['agent-1'] = {
      agencyConfig: { modelSelectionPolicy: 'fixed' },
      model: 'gpt-4',
      visibility: 'public',
      workspaceId: 'workspace-1',
    };

    render(<AgentModelConfig agentId="agent-1" />);

    expect(screen.getByTestId('model-select')).toBeTruthy();
    expect(screen.queryByTestId('policy-menu')).toBeNull();
  });

  it('renders nothing instead of crashing while the agent config is not loaded yet', () => {
    const { container } = render(<AgentModelConfig agentId="missing-agent" />);

    expect(container.firstChild).toBeNull();
  });
});
