import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

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
  WorkspaceAgentPolicyCard: ({ children, title }: { children: ReactNode; title: string }) => (
    <div>
      <span>{title}</span>
      {children}
    </div>
  ),
  WorkspaceAgentSelectionPolicyMenu: () => <div data-testid="policy-menu" />,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof testState.agent) => unknown) =>
    selector(testState.agent),
}));

describe('WorkspaceAgentModelPolicy', () => {
  it('renders the policy card for a loaded workspace agent', () => {
    render(<WorkspaceAgentModelPolicy agentId="agent-1" />);

    expect(screen.getByText('settingAgent.modelPolicy.title')).toBeTruthy();
    expect(screen.getByTestId('model-select')).toBeTruthy();
  });

  it('renders nothing instead of crashing while the agent config is not loaded yet', () => {
    const { container } = render(<WorkspaceAgentModelPolicy agentId="missing-agent" />);

    expect(container.firstChild).toBeNull();
  });
});
