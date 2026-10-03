import type { CodexPermissionMode, HeterogeneousProviderConfig } from '@lobechat/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProfileEditor from './index';

const fixture = vi.hoisted(() => ({
  canEdit: true,
  provider: {
    type: 'codex',
    permissionMode: 'read-only',
    args: ['--model', 'gpt-5'],
  } as HeterogeneousProviderConfig,
  target: 'device',
  update: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@lobechat/const', () => ({ isDesktop: true }));
vi.mock('@/business/agent-share', () => ({ AGENT_SHARE_ALLOWED_PROVIDERS: undefined }));
vi.mock('@/business/client/useAgentShareSupported', () => ({
  useAgentShareSupported: () => ({ isShared: false }),
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: fixture.canEdit }) }));
vi.mock('@/hooks/useEnabledChatModels', () => ({ useEnabledChatModels: () => [] }));
vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => ({
    agencyConfig: { executionTarget: fixture.target },
    workspaceScoped: false,
  }),
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: object) => unknown) =>
    selector({
      activeAgentId: 'agent-codex',
      updateAgentConfigById: fixture.update,
      useFetchServerDefaultHeterogeneousCapability: () => ({
        data: { enabled: false },
        mutate: vi.fn(),
      }),
    }),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: { isWorkspaceAgentById: () => () => false },
  agentSelectors: {
    getAgentConfigById: () => () => ({ agencyConfig: { heterogeneousProvider: fixture.provider } }),
    isCurrentAgentHeterogeneous: () => true,
  },
}));
vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: { getEnabledModelById: () => () => undefined },
  useAiInfraStore: () => undefined,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Alert: () => null,
  Button: () => null,
  Tabs: ({ items }: { items: Array<{ key: string; children: ReactNode }> }) => (
    <>
      {items.map((item) => (
        <div key={item.key}>{item.children}</div>
      ))}
    </>
  ),
}));
vi.mock('@/components/LobeIcons', () => ({ ModelIcon: () => null }));
vi.mock('@/features/ModelSelect/ReasoningEffortSelect', () => ({ default: () => null }));
vi.mock('@/features/ModelSwitchPanel', () => ({ default: () => null }));
vi.mock('@/features/ProfileEditor/AgentUserTools/RunPriorityHint', () => ({ default: () => null }));
vi.mock('../EditorCanvas', () => ({ default: () => null }));
vi.mock('./AgentHeader', () => ({ default: () => null }));
vi.mock('./AgentTool', () => ({ default: () => null }));
vi.mock('./CloudHeterogeneousConfig', () => ({ default: () => null }));
vi.mock('./RemoteAgentConfigCard', () => ({ default: () => null }));
vi.mock('./WorkspaceAgentDevicePolicy', () => ({ default: () => null }));
vi.mock('./WorkspaceAgentModelPolicy', () => ({ WorkspaceAgentModelPolicy: () => null }));
vi.mock('./WorkspaceAgentPolicyCard', () => ({ WorkspaceAgentPolicyCard: () => null }));
vi.mock('./HeterogeneousAgentStatusCard', () => ({
  default: ({
    onPermissionModeChange,
  }: {
    onPermissionModeChange: (mode: CodexPermissionMode) => Promise<void>;
  }) => (
    <>
      <button onClick={() => void onPermissionModeChange('full-access')}>
        Confirm full access
      </button>
      <button onClick={() => void onPermissionModeChange('ask')}>Approval</button>
    </>
  ),
}));

/** @example A confirmed child selection must reach the parent persistence callback. */
describe('ProfileEditor Codex permission persistence', () => {
  beforeEach(() => {
    fixture.canEdit = true;
    fixture.target = 'device';
    fixture.update.mockClear();
  });

  // ROOT CAUSE:
  // The remote status card allowed confirmed Full access, but the parent returned
  // for every nonlocal target before persisting. Allow only the executable remote
  // preset through this boundary; preserve permissions and provider fields.
  /** @example Device target + confirmed full-access saves the complete provider config. */
  it('persists confirmed Full access for a connected device', async () => {
    render(<ProfileEditor />);
    fireEvent.click(screen.getByText('Confirm full access'));
    await waitFor(() => {
      /** @example The persisted mode changes without dropping existing CLI args. */
      expect(fixture.update).toHaveBeenCalledWith('agent-codex', {
        agencyConfig: {
          heterogeneousProvider: { ...fixture.provider, permissionMode: 'full-access' },
        },
      });
    });
  });

  /** @example A sandbox target can persist the same explicit recovery mode. */
  it('persists confirmed Full access for a sandbox', async () => {
    fixture.target = 'sandbox';
    render(<ProfileEditor />);
    fireEvent.click(screen.getByText('Confirm full access'));
    await waitFor(() => {
      /** @example Exactly one provider update follows the confirmed selection. */
      expect(fixture.update).toHaveBeenCalledOnce();
    });
  });

  /** @example An unsupported remote approval preset never reaches persistence. */
  it('rejects approval mode on a connected device', () => {
    render(<ProfileEditor />);
    fireEvent.click(screen.getByText('Approval'));
    /** @example The child cannot bypass the parent execution-target guard. */
    expect(fixture.update).not.toHaveBeenCalled();
  });

  /** @example A read-only collaborator cannot save Full access. */
  it('retains the edit permission guard', () => {
    fixture.canEdit = false;
    render(<ProfileEditor />);
    fireEvent.click(screen.getByText('Confirm full access'));
    /** @example No mutation is issued without edit permission. */
    expect(fixture.update).not.toHaveBeenCalled();
  });
});
