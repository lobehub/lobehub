import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HeteroControlBar from './index';

const fixture = vi.hoisted(() => ({
  confirm: vi.fn<(options: { onOk: () => Promise<void> }) => void>(),
  running: false,
  canConfigure: true,
  nativePermissions: true,
  update: vi.fn(async () => {}),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: { updateAgentConfigById: typeof fixture.update }) => unknown) =>
    selector({ updateAgentConfigById: fixture.update }),
}));
vi.mock('@/store/chat', () => ({
  useChatStore: Object.assign(() => fixture.running, { getState: () => ({}) }),
}));
vi.mock('@/store/chat/selectors', () => ({
  agentRunSelectors: { isCurrentSendMessageLoading: () => fixture.running },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@lobehub/ui', () => ({
  Icon: () => null,
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Skeleton: () => null,
  confirmModal: fixture.confirm,
  toast: { error: vi.fn(), info: vi.fn() },
  Select: ({
    options,
    onChange,
    readOnly,
    value,
  }: {
    options: { disabled?: boolean; label: string; value: string }[];
    onChange: (value: string) => void;
    readOnly: boolean;
    value: string;
  }) => (
    <select
      aria-label="Permissions"
      disabled={readOnly}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option disabled={option.disabled} key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@lobechat/const', () => ({ isDesktop: false }));
vi.mock('@lobechat/electron-client-ipc', () => ({ useWatchBroadcast: () => {} }));
vi.mock('@/features/ChatInput/hooks/useAgentId', () => ({ useAgentId: () => 'agent' }));
vi.mock('@/features/ChatInput/hooks/useChatInputResourceAccess', () => ({
  useChatInputResourceAccess: () => ({
    canConfigureResource: fixture.canConfigure,
    isAccessLoading: false,
  }),
}));
vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => ({
    agencyConfig: {
      boundDeviceId: 'device',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'codex', permissionMode: 'read-only' },
    },
    workspaceScoped: false,
  }),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: { isAgentConfigLoadingById: () => () => false },
}));
vi.mock('@/store/device/capabilityHooks', () => ({
  useDeviceCapabilities: () => ({ data: { nativeCodexPermissions: fixture.nativePermissions } }),
}));
vi.mock('@/business/client/features/ChatInputCredits', () => ({ default: () => null }));
vi.mock('@/features/ChatInput/ControlBar/HeteroDeviceSwitcher', () => ({
  default: () => <span>Device</span>,
}));
vi.mock('@/features/ChatInput/ControlBar/WorkspaceControls', () => ({
  default: () => <span>Workspace</span>,
}));
vi.mock('./QuotaMenu', () => ({
  ClaudeCodeQuotaMenu: () => null,
  CodexQuotaMenu: () => null,
  KimiCodeQuotaMenu: () => null,
}));

// ROOT CAUSE:
// HeteroControlBar returned the Web branch before rendering CodexPermissionControl.
// A real connected Codex device therefore advertised native permissions but its
// owner could not select them. Render the same guarded control on both surfaces.
/** @example Web device owners can select policies supported by their actual device. */
describe('Web device permissions', () => {
  beforeEach(() => {
    fixture.confirm.mockClear();
    fixture.update.mockClear();
    fixture.running = false;
    fixture.canConfigure = true;
    fixture.nativePermissions = true;
  });

  /** @example Choosing Ask through the Web parent persists the Agent policy. */
  it('renders the real selector and persists Ask for a capable device', async () => {
    render(<HeteroControlBar />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ask' } });
    await waitFor(() => {
      /** @example The provider type and explicit permission are saved together. */
      expect(fixture.update).toHaveBeenCalledWith('agent', {
        agencyConfig: { heterogeneousProvider: { type: 'codex', permissionMode: 'ask' } },
      });
    });
  });

  /** @example An older device cannot select an unsupported safer preset. */
  it('retains capability gating and explicit Full access confirmation on Web', async () => {
    fixture.nativePermissions = false;
    render(<HeteroControlBar />);
    /** @example Read only remains disabled until the device advertises support. */
    expect(
      screen.getByRole('option', { name: 'heteroAgent.codexPermission.mode.read-only' }),
    ).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ask' } });
    /** @example An unsupported synthetic change cannot persist a policy. */
    expect(fixture.update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'full-access' } });
    /** @example Full access still waits for the user's confirmation. */
    expect(fixture.update).not.toHaveBeenCalled();
    await act(async () => fixture.confirm.mock.calls[0][0].onOk());
    /** @example Only explicit confirmation saves Full access. */
    expect(fixture.update).toHaveBeenCalledWith('agent', {
      agencyConfig: { heterogeneousProvider: { type: 'codex', permissionMode: 'full-access' } },
    });
  });

  /** @example A can-use collaborator may choose a device but cannot change its Agent policy. */
  it('does not expose configuration to a can-use collaborator', () => {
    fixture.canConfigure = false;
    render(<HeteroControlBar />);
    /** @example The permission selector is absent. */
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    /** @example The personal device switcher remains available. */
    expect(screen.getByText('Device')).toBeInTheDocument();
  });
});
