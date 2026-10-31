import { act, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { useDeviceStore } from '@/store/device';
import { DEVICE_LIST_KEY } from '@/store/device/projection';
import { projectFileActions } from '@/store/projectFile';

import {
  agentStore,
  effectiveConfig,
  filesPrefetchProps,
  filesProps,
  globalStore,
  reviewState,
} from './harness';

// The first frame is what the cold start is about: the deferred follow-up pass
// that gates the other panes has not run yet. Most cases assert the settled
// state; the cold-mount case flips this to false.
const deferredMount = vi.hoisted(() => ({ value: true }));
vi.mock('@/hooks/useDeferredMount', () => ({ useDeferredMount: () => deferredMount.value }));

// Loaded after the harness so its module mocks are registered first.
let AgentWorkingSidebar: ComponentType<{ availableWidth?: number }>;

beforeAll(async () => {
  AgentWorkingSidebar = (await import('../index')).default;
});

describe('AgentWorkingSidebar — Files cold start', () => {
  it('reads the Files tree while the panel is collapsed on a remembered Files tab', () => {
    agentStore.activeAgentId = 'agent';
    effectiveConfig.agencyConfig = { executionTarget: 'local' };
    reviewState.workingDirectory = '/repo';
    globalStore.status.showRightPanel = false;
    globalStore.status.workingSidebarTab = 'files';

    render(<AgentWorkingSidebar />);

    expect(filesPrefetchProps.current).toMatchObject({ workingDirectory: '/repo' });
  });

  it('hands the read to the visible Files pane once it has mounted', () => {
    agentStore.activeAgentId = 'agent';
    effectiveConfig.agencyConfig = { executionTarget: 'local' };
    reviewState.workingDirectory = '/repo';
    globalStore.status.workingSidebarTab = 'files';

    render(<AgentWorkingSidebar />);

    expect(filesProps.current).toMatchObject({ workingDirectory: '/repo' });
    expect(screen.queryByTestId('files-prefetch')).not.toBeInTheDocument();
  });

  it('mounts the Files pane on the first frame instead of the deferred skeleton', () => {
    agentStore.activeAgentId = 'agent';
    effectiveConfig.agencyConfig = { executionTarget: 'local' };
    reviewState.workingDirectory = '/repo';
    globalStore.status.workingSidebarTab = 'files';
    deferredMount.value = false;

    render(<AgentWorkingSidebar />);

    // The pane owns its own "no saved tree" spinner, so the sidebar's deferred
    // skeleton would only cover the tree that is already saved for this folder.
    expect(screen.getByTestId('files')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-skeleton')).not.toBeInTheDocument();
    deferredMount.value = true;
  });

  it('opens the tree where the conversation last was until the device list is confirmed', () => {
    agentStore.activeAgentId = 'agent';
    effectiveConfig.agencyConfig = { executionTarget: 'local' };
    // Without the device default the cwd falls back to home.
    reviewState.workingDirectory = '/Users/me';
    globalStore.status.workingSidebarTab = 'files';
    projectFileActions.rememberFilesLocation('agent/agent', { directory: '/repo' });

    const { rerender } = render(<AgentWorkingSidebar />);
    expect(filesProps.current).toEqual({ deviceId: undefined, workingDirectory: '/repo' });

    act(() => {
      // A hydrated list already counts as loaded but its `workingDirs` are
      // stale, so only the server-confirmed state may replace the remembered
      // directory.
      useDeviceStore.setState((state) => ({
        deviceListMap: { [DEVICE_LIST_KEY]: [] },
        deviceListReplica: {
          ...state.deviceListReplica,
          entries: {
            ...state.deviceListReplica.entries,
            [DEVICE_LIST_KEY]: { pending: [], source: 'server', updatedAt: Date.now() },
          },
        },
      }));
    });
    rerender(<AgentWorkingSidebar />);
    expect(filesProps.current).toMatchObject({
      deviceId: undefined,
      workingDirectory: '/Users/me',
    });
  });
});
