/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import UserToolsSection from './UserToolsSection';

// Regression for the profile "double display" bug: an agent-scoped connector
// (e.g. a Composio account bound to this agent) is pinned into `config.plugins`
// for runtime gating. It is rendered in the "Agent Tools" section above; it must
// NOT also be counted/shown in this base ("Workspace/User") section — where,
// lacking a base-dimension manifest, it rendered as an extra "uninstalled" chip
// and inflated the header count.

const mocks = vi.hoisted(() => ({
  toolState: {
    // connectorSelectors.agentConnectors(agentId) reads s.agentConnectors[agentId]
    agentConnectors: {} as Record<
      string,
      Array<{ agentId: string; id: string; identifier: string }>
    >,
    connectors: [] as unknown[],
  },
  agentConfig: { plugins: [] as unknown[] },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Personal vs workspace only changes the label, not the count under test.
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => 'ws-1',
}));

// The chips themselves are rendered by AgentTool (covered separately); stub it
// so this test isolates the header count wiring.
vi.mock('@/features/ProfileEditor/AgentTool', () => ({ default: () => null }));
vi.mock('@/features/ProfileEditor/PluginTag', () => ({ default: () => null }));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span data-testid="label">{children}</span>,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
}));

// Apply the real selectors against the mock state.
vi.mock('@/store/tool', () => ({
  useToolStore: (sel: (s: unknown) => unknown) => sel(mocks.toolState),
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (sel: (s: unknown) => unknown) => sel(undefined),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: { getAgentConfigById: () => () => mocks.agentConfig },
}));

const renderSection = () =>
  render(
    <UserToolsSection
      agentId="agent-1"
      copyMode={false}
      copying={false}
      selected={new Set()}
      toggleSelected={() => {}}
      onCancelCopy={() => {}}
      onConfirmCopy={() => {}}
    />,
  );

const labelText = () => screen.getByTestId('label').textContent;

describe('UserToolsSection — base tool count excludes agent-owned connectors', () => {
  beforeEach(() => {
    mocks.toolState.agentConnectors = {};
    mocks.toolState.connectors = [];
    mocks.agentConfig = { plugins: [] };
  });

  it('does not count an agent-owned connector identifier pinned in config.plugins', () => {
    // google-drive is pinned for the agent AND is an agent-owned connector row →
    // it belongs to the Agent Tools section, so this section's count must be 0.
    mocks.agentConfig = { plugins: [{ identifier: 'google-drive', mode: 'pinned' }] };
    mocks.toolState.agentConnectors = {
      'agent-1': [{ agentId: 'agent-1', id: 'c1', identifier: 'google-drive' }],
    };

    renderSection();

    expect(labelText()).toContain('· 0');
  });

  it('still counts a genuine base pinned tool that is not an agent connector', () => {
    mocks.agentConfig = {
      plugins: [
        { identifier: 'google-drive', mode: 'pinned' }, // agent-owned → excluded
        { identifier: 'some-user-plugin', mode: 'pinned' }, // base → counted
      ],
    };
    mocks.toolState.agentConnectors = {
      'agent-1': [{ agentId: 'agent-1', id: 'c1', identifier: 'google-drive' }],
    };

    renderSection();

    expect(labelText()).toContain('· 1');
  });
});
