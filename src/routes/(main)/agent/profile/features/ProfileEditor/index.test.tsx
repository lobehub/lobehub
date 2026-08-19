import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProfileEditor from './index';

const testState = vi.hoisted(() => ({
  activeAgentId: 'agent-1' as string,
  config: undefined as Record<string, unknown> | undefined,
  isDesktop: false,
  isHeterogeneous: false,
  isWorkspaceAgent: false,
}));

vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return testState.isDesktop;
  },
}));

vi.mock('@lobechat/heterogeneous-agents', () => ({
  isRemoteHeterogeneousType: () => false,
}));

vi.mock('@lobechat/heterogeneous-agents/client', () => ({
  getHeterogeneousAgentClientConfig: (type: string) => ({
    defaultCommand: type === 'claude-code' ? 'claude' : 'codex',
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Tabs: ({
    items,
  }: {
    items?: Array<{ key: string; label: React.ReactNode; children?: React.ReactNode }>;
  }) => (
    <div>
      {items?.map((item) => (
        <div key={item.key}>
          {item.label}
          {item.children}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({}),
  cssVar: new Proxy({}, { get: () => 'var(--x)' }),
}));

vi.mock('lucide-react', () => ({ Wrench: () => null }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/DeviceManager/useDeviceList', () => ({
  useDeviceList: () => ({ data: [] }),
}));

vi.mock('@/features/DeviceManager/deviceStatus', () => ({
  DeviceTabLabel: ({ agentType }: { agentType?: string }) => (
    <span>{`DeviceTabLabel:${agentType ?? 'none'}`}</span>
  ),
}));

vi.mock('@/features/DeviceManager/HeterogeneousAgentStatusCard', () => ({
  default: () => <span>HeterogeneousAgentStatusCard</span>,
}));

vi.mock('@/features/ModelSelect', () => ({ default: () => <span>ModelSelect</span> }));

vi.mock('@/features/ProfileEditor/AgentUserTools/RunPriorityHint', () => ({
  default: () => <span>RunPriorityHint</span>,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (
    selector: (state: { activeAgentId: string }) => unknown,

    _equalityFn?: (a: unknown, b: unknown) => boolean,
  ) => selector({ activeAgentId: testState.activeAgentId }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    isWorkspaceAgentById: () => () => testState.isWorkspaceAgent,
  },
  agentSelectors: {
    getAgentConfigById: () => () => testState.config,
    isCurrentAgentHeterogeneous: () => testState.isHeterogeneous,
  },
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: unknown) => unknown) =>
    selector({
      gatewayDeviceInfo: undefined,
      useFetchGatewayDeviceInfo: () => ({}),
    }),
}));

vi.mock('../EditorCanvas', () => ({ default: () => <span>EditorCanvas</span> }));
vi.mock('./AgentHeader', () => ({ default: () => <span>AgentHeader</span> }));
vi.mock('./AgentTool', () => ({ default: () => <span>AgentTool</span> }));
vi.mock('./CloudHeterogeneousConfig', () => ({
  default: () => <span>CloudHeterogeneousConfig</span>,
}));
vi.mock('./RemoteAgentConfigCard', () => ({
  default: () => <span>RemoteAgentConfigCard</span>,
}));
vi.mock('./WorkspaceAgentDevicePolicy', () => ({
  default: () => <span>WorkspaceAgentDevicePolicy</span>,
}));
vi.mock('./WorkspaceAgentModelPolicy', () => ({
  WorkspaceAgentModelPolicy: () => <span>WorkspaceAgentModelPolicy</span>,
}));
vi.mock('./WorkspaceAgentPolicyCard', () => ({
  WorkspaceAgentPolicyCard: () => <span>WorkspaceAgentPolicyCard</span>,
}));

describe('ProfileEditor', () => {
  beforeEach(() => {
    testState.config = { model: 'gpt-4o', provider: 'openai' };
    testState.isDesktop = false;
    testState.isHeterogeneous = false;
    testState.isWorkspaceAgent = false;
  });

  it('renders the built-in runtime config panel for non-heterogeneous agents', () => {
    // Regression: `heterogeneousProvider` is undefined for built-in agents —
    // the heterogeneous tabs must not be built (or dereferenced) then.
    render(<ProfileEditor />);

    expect(screen.getByText('ModelSelect')).toBeInTheDocument();
    expect(screen.queryByText('HeterogeneousAgentStatusCard')).not.toBeInTheDocument();
  });

  it('does not crash while the agent config is still loading', () => {
    testState.config = undefined;

    render(<ProfileEditor />);

    expect(screen.getByText('ModelSelect')).toBeInTheDocument();
  });

  it('builds the Cloud tab for Claude Code heterogeneous agents', () => {
    testState.isHeterogeneous = true;
    testState.config = {
      agencyConfig: { heterogeneousProvider: { type: 'claude-code' } },
    };

    render(<ProfileEditor />);

    expect(screen.getByText('CloudHeterogeneousConfig')).toBeInTheDocument();
  });

  it('builds the local-machine tab for heterogeneous agents on desktop', () => {
    testState.isDesktop = true;
    testState.isHeterogeneous = true;
    testState.config = {
      agencyConfig: { heterogeneousProvider: { type: 'codex' } },
    };

    render(<ProfileEditor />);

    expect(screen.getByText('HeterogeneousAgentStatusCard')).toBeInTheDocument();
    expect(screen.getByText('DeviceTabLabel:codex')).toBeInTheDocument();
  });
});
