import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceAgentModelPolicy } from './WorkspaceAgentModelPolicy';

const testState = vi.hoisted(() => ({
  agent: {
    agentMap: {
      'agent-1': {
        agencyConfig: {
          modelSelectionPolicy: 'member' as const,
        },
        model: 'gpt-4',
        visibility: 'public' as 'private' | 'public',
        workspaceId: 'workspace-1',
      },
    } as Record<string, object>,
    updateAgentConfigById: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/features/ModelSelect', () => ({
  default: () => <div data-testid="model-select" />,
}));

vi.mock('./WorkspaceAgentPolicyCard', () => ({
  WorkspaceAgentPolicyCard: ({
    action,
    children,
    title,
  }: {
    action: ReactNode;
    children: ReactNode;
    title: string;
  }) => (
    <div>
      <span>{title}</span>
      {action}
      {children}
    </div>
  ),
  WorkspaceAgentSelectionPolicyMenu: ({ locked }: { locked: boolean }) => (
    <div data-locked={String(locked)} data-testid="policy-menu" />
  ),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof testState.agent) => unknown) =>
    selector(testState.agent),
}));

describe('WorkspaceAgentModelPolicy', () => {
  beforeEach(() => {
    testState.agent.agentMap['agent-1'] = {
      agencyConfig: { modelSelectionPolicy: 'member' },
      model: 'gpt-4',
      visibility: 'public',
      workspaceId: 'workspace-1',
    };
  });

  it('renders the policy card for a loaded workspace agent', () => {
    render(<WorkspaceAgentModelPolicy agentId="agent-1" />);

    expect(screen.getByText('settingAgent.modelPolicy.title')).toBeTruthy();
    expect(screen.getByTestId('model-select')).toBeTruthy();
  });

  it('shows a legacy public Workspace Agent without a persisted policy as unlocked', () => {
    testState.agent.agentMap['agent-1'] = {
      agencyConfig: undefined,
      model: 'gpt-4',
      visibility: 'public',
      workspaceId: 'workspace-1',
    };

    render(<WorkspaceAgentModelPolicy agentId="agent-1" />);

    expect(screen.getByTestId('policy-menu').getAttribute('data-locked')).toBe('false');
  });

  it('renders nothing instead of crashing while the agent config is not loaded yet', () => {
    const { container } = render(<WorkspaceAgentModelPolicy agentId="missing-agent" />);

    expect(container.firstChild).toBeNull();
  });
});
