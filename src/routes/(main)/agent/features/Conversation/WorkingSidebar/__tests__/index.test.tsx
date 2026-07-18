import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AgentWorkingSidebar from '../index';

// ─── captured RightPanel props ────────────────────────────────────────────────
// The real RightPanel is a controlled DraggablePanel; here we stub it so the test
// can read back the `width` it receives and drive its `onSizeChange` directly.

interface CapturedRightPanelProps {
  children?: ReactNode;
  defaultWidth?: number | string;
  maxWidth?: number | string;
  onSizeChange?: (size?: { height?: number | string; width?: number | string }) => void;
  width?: number | string;
}

const rightPanel = vi.hoisted(() => ({
  current: undefined as CapturedRightPanelProps | undefined,
}));

const agentStore = vi.hoisted(() => ({
  activeAgentId: undefined as string | undefined,
  isHeterogeneous: false,
  rawAgencyConfig: undefined as
    { boundDeviceId?: string; executionTarget?: 'device' | 'local' } | undefined,
}));

const effectiveConfig = vi.hoisted(() => ({
  agencyConfig: undefined as
    { boundDeviceId?: string; executionTarget?: 'device' | 'local' } | undefined,
  workspaceScoped: false,
}));

const filesProps = vi.hoisted(() => ({
  current: undefined as { deviceId?: string; workingDirectory: string } | undefined,
}));

const reviewState = vi.hoisted(() => ({
  repoType: undefined as string | undefined,
  showTree: false,
  workingDirectory: undefined as string | undefined,
}));

const globalStore = vi.hoisted(() => ({
  updateSystemStatus: vi.fn(),
  toggleRightPanel: vi.fn(),
  setWorkingSidebarTab: vi.fn(),
  status: {
    showRightPanel: true,
    workingSidebarTab: 'params' as string | undefined,
    workingSidebarWidth: 360 as number | undefined,
  },
}));

vi.mock('@/features/RightPanel', () => ({
  default: (props: CapturedRightPanelProps) => {
    rightPanel.current = props;
    return <div data-testid="right-panel">{props.children}</div>;
  },
}));

// ─── stub every downstream dependency so the sidebar renders deterministically ──

vi.mock('../Files', () => ({
  default: (props: { deviceId?: string; workingDirectory: string }) => {
    filesProps.current = props;
    return <div data-testid="files" />;
  },
}));
vi.mock('../Review', () => ({ default: () => <div /> }));
vi.mock('../ProgressSection', () => ({ default: () => <div /> }));
vi.mock('../ResourcesSection', () => ({ default: () => <div /> }));
vi.mock('../ParamsSection', () => ({ default: () => <div /> }));
vi.mock('../WorksSection', () => ({ default: () => <div /> }));

vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => agentStore,
  useAgentStore: (selector: (s: typeof agentStore) => unknown) => selector(agentStore),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: () => () => agentStore.rawAgencyConfig,
    isWorkspaceAgentById: () => () => false,
  },
  agentSelectors: {
    isCurrentAgentHeterogeneous: () => agentStore.isHeterogeneous,
  },
  chatConfigByIdSelectors: {
    isChatModeById: () => () => false,
  },
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: typeof globalStore) => unknown) => selector(globalStore),
}));
vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    workingSidebarWidth: (s: typeof globalStore) => s.status.workingSidebarWidth || 360,
  },
}));
vi.mock('@/store/electron', () => ({ useElectronStore: () => undefined }));
vi.mock('@/store/chat', () => ({ useChatStore: () => undefined }));

vi.mock('@/business/client/features/WorkingSidebarTabs', () => ({
  useBusinessWorkingSidebarTabs: () => [],
}));

vi.mock('@/features/ChatInput/ControlBar/useRepoType', () => ({
  useRepoType: () => reviewState.repoType,
}));
vi.mock('@/hooks/useEffectiveWorkingDirectory', () => ({
  useEffectiveWorkingDirectory: () => reviewState.workingDirectory,
}));
vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => ({
    agencyConfig: effectiveConfig.agencyConfig,
    workspaceScoped: effectiveConfig.workspaceScoped,
  }),
}));
vi.mock('@/hooks/useLocalStorageState', () => ({
  useLocalStorageState: () => [reviewState.showTree, vi.fn()],
}));
vi.mock('@/helpers/agentWorkingDirectory', () => ({ resolveTargetDeviceId: () => undefined }));
vi.mock('@/helpers/executionTarget', () => ({
  resolveExecutionTarget: (
    agencyConfig: { executionTarget?: 'device' | 'local' } | undefined,
    options: { workspaceScoped?: boolean },
  ) => (options.workspaceScoped ? 'device' : (agencyConfig?.executionTarget ?? 'local')),
}));
vi.mock('@/helpers/gatewayMode', () => ({ useIsGatewayModeEnabled: () => false }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => <button type="button" />,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => () => ({}),
}));

beforeEach(() => {
  agentStore.activeAgentId = undefined;
  agentStore.isHeterogeneous = false;
  agentStore.rawAgencyConfig = undefined;
  effectiveConfig.agencyConfig = undefined;
  effectiveConfig.workspaceScoped = false;
  filesProps.current = undefined;
  reviewState.repoType = undefined;
  reviewState.showTree = false;
  reviewState.workingDirectory = undefined;
  globalStore.status.workingSidebarWidth = 360;
  globalStore.status.showRightPanel = true;
  globalStore.status.workingSidebarTab = 'params';
  globalStore.updateSystemStatus.mockReset();
  globalStore.toggleRightPanel.mockReset();
  globalStore.setWorkingSidebarTab.mockReset();
});

afterEach(() => {
  rightPanel.current = undefined;
  vi.clearAllMocks();
});

describe('AgentWorkingSidebar — controlled panel width', () => {
  it('seeds the RightPanel with the default width', () => {
    render(<AgentWorkingSidebar />);

    expect(rightPanel.current?.width).toBe(360);
  });

  it('allows the panel to grow across wide displays without consuming the full viewport', () => {
    render(<AgentWorkingSidebar />);

    expect(rightPanel.current?.maxWidth).toBe(1200);
  });

  it('restores a previously persisted width from systemStatus', () => {
    globalStore.status.workingSidebarWidth = 520;

    render(<AgentWorkingSidebar />);

    expect(rightPanel.current?.width).toBe(520);
  });

  it('clamps two-pane Review width without overwriting the persisted preference', () => {
    agentStore.activeAgentId = 'agent';
    reviewState.repoType = 'git';
    reviewState.showTree = true;
    reviewState.workingDirectory = 'C:\\repo';
    globalStore.status.workingSidebarTab = 'review';

    const { unmount } = render(<AgentWorkingSidebar />);

    expect(rightPanel.current?.defaultWidth).toBe(560);
    expect(rightPanel.current?.width).toBe(560);
    expect(globalStore.updateSystemStatus).not.toHaveBeenCalled();

    unmount();
    globalStore.status.workingSidebarTab = 'params';
    render(<AgentWorkingSidebar />);
    expect(rightPanel.current?.width).toBe(360);
  });

  // Regression: DraggablePanel reports the dragged width as a `"480px"` string on
  // drag-stop. A `typeof width === 'number'` guard silently dropped it, so the
  // controlled width never updated and the panel snapped back — appearing
  // impossible to resize. The handler must parse the px string.
  it('applies a "480px" string width from a drag so the panel actually resizes', () => {
    const { unmount } = render(<AgentWorkingSidebar />);

    act(() => {
      rightPanel.current?.onSizeChange?.({ width: '480px' });
    });

    expect(globalStore.updateSystemStatus).toHaveBeenCalledWith({ workingSidebarWidth: 480 });

    globalStore.status.workingSidebarWidth = 480;
    unmount();
    render(<AgentWorkingSidebar />);
    expect(rightPanel.current?.width).toBe(480);
  });

  it('applies a numeric drag width unchanged', () => {
    const { unmount } = render(<AgentWorkingSidebar />);

    act(() => {
      rightPanel.current?.onSizeChange?.({ width: 500 });
    });

    expect(globalStore.updateSystemStatus).toHaveBeenCalledWith({ workingSidebarWidth: 500 });

    globalStore.status.workingSidebarWidth = 500;
    unmount();
    render(<AgentWorkingSidebar />);
    expect(rightPanel.current?.width).toBe(500);
  });

  it('ignores a size update with no width', () => {
    render(<AgentWorkingSidebar />);

    act(() => {
      rightPanel.current?.onSizeChange?.({ height: '100%' });
    });

    expect(rightPanel.current?.width).toBe(360);
    expect(globalStore.updateSystemStatus).not.toHaveBeenCalled();
  });

  it('indexes a workspace-local project on this desktop instead of the shared bound device', () => {
    agentStore.activeAgentId = 'agent';
    agentStore.isHeterogeneous = true;
    // The shared row can still point at a workspace device. This member's
    // private override selects their own desktop and must win for both the cwd
    // and the file transport.
    agentStore.rawAgencyConfig = {
      boundDeviceId: 'workspace-device',
      executionTarget: 'device',
    };
    effectiveConfig.agencyConfig = {
      boundDeviceId: 'personal-device',
      executionTarget: 'local',
    };
    reviewState.workingDirectory = '/Users/me/project';
    globalStore.status.workingSidebarTab = 'files';

    render(<AgentWorkingSidebar />);

    expect(filesProps.current).toEqual({
      deviceId: undefined,
      workingDirectory: '/Users/me/project',
    });
  });

  it('keeps a shared local fallback on its bound workspace device without a member override', () => {
    agentStore.activeAgentId = 'agent';
    agentStore.isHeterogeneous = true;
    effectiveConfig.agencyConfig = {
      boundDeviceId: 'workspace-device',
      executionTarget: 'local',
    };
    effectiveConfig.workspaceScoped = true;
    reviewState.workingDirectory = '/workspace/project';
    globalStore.status.workingSidebarTab = 'files';

    render(<AgentWorkingSidebar />);

    expect(filesProps.current).toEqual({
      deviceId: 'workspace-device',
      workingDirectory: '/workspace/project',
    });
  });
});
