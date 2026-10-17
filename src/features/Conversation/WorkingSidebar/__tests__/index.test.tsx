import type { DeviceGitPullRequestDetail } from '@lobechat/types';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import PullRequestSections from '../PullRequest/Sections';
import {
  agentStore,
  browserPanes,
  businessTabs,
  chatStore,
  dropdownMenuState,
  effectiveConfig,
  filesProps,
  globalStore,
  linkedPR,
  localStorageState,
  paramsSectionState,
  platform,
  renderedReview,
  reviewState,
  rightPanel,
  workspace,
} from './harness';

// Loaded after the mock harness so module mocks are registered first.
let AgentWorkingSidebar: ComponentType<{ availableWidth?: number }>;

beforeAll(async () => {
  AgentWorkingSidebar = (await import('../index')).default;
});

describe('AgentWorkingSidebar — controlled panel width', () => {
  it('opens a scoped saved PR before branch lookup and discards it after authoritative empty lookup', () => {
    linkedPR.branch = undefined;
    reviewState.workingDirectory = '/repo';
    chatStore.activeTopicId = 'topic-pr';
    chatStore.topicDetailMap = {
      'topic-pr': {
        id: 'topic-pr',
        metadata: {
          workingDirectoryConfig: {
            path: '/repo',
            git: {
              branch: 'feature',
              github: {
                pullRequest: {
                  number: 42,
                  title: 'Saved PR',
                  state: 'open',
                  url: 'https://github.com/test/repo/pull/42',
                },
              },
            },
          },
        },
      },
    };
    globalStore.status.workingSidebarTab = 'pr';
    localStorageState.openTabsByContext = { 'topic:topic-pr': ['pr'] };
    const { rerender } = render(<AgentWorkingSidebar />);
    expect(screen.getByRole('textbox', { name: 'PR draft' })).toBeInTheDocument();
    linkedPR.status = 'ok';
    rerender(<AgentWorkingSidebar availableWidth={1200} />);
    expect(screen.queryByRole('textbox', { name: 'PR draft' })).not.toBeInTheDocument();
  });

  it.each([
    { path: '/other', boundDeviceId: undefined },
    { path: '/repo', boundDeviceId: 'other-device' },
  ])('does not bootstrap a snapshot from another scope: %o', ({ path, boundDeviceId }) => {
    linkedPR.branch = undefined;
    reviewState.workingDirectory = '/repo';
    chatStore.activeTopicId = 'topic-pr';
    chatStore.topicDetailMap = {
      'topic-pr': {
        id: 'topic-pr',
        metadata: {
          boundDeviceId,
          workingDirectoryConfig: {
            path,
            git: {
              github: {
                pullRequest: {
                  number: 42,
                  state: 'open',
                  title: 'Other PR',
                  url: 'https://github.com/test/repo/pull/42',
                },
              },
            },
          },
        },
      },
    };
    globalStore.status.workingSidebarTab = 'pr';
    localStorageState.openTabsByContext = { 'topic:topic-pr': ['pr'] };
    render(<AgentWorkingSidebar />);
    expect(screen.queryByRole('textbox', { name: 'PR draft' })).not.toBeInTheDocument();
  });

  it('resets PR state when the PR number or directory changes', () => {
    reviewState.repoType = 'github';
    reviewState.workingDirectory = '/repo';
    linkedPR.number = 1;
    globalStore.status.workingSidebarTab = 'pr';
    localStorageState.openTabsByContext = { 'draft:default:none': ['pr'] };
    const { rerender } = render(<AgentWorkingSidebar />);
    fireEvent.change(screen.getByLabelText('PR draft'), { target: { value: 'old draft' } });
    linkedPR.number = 2;
    rerender(<AgentWorkingSidebar availableWidth={1600} />);
    expect(screen.getByLabelText('PR draft')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('PR draft'), { target: { value: 'another draft' } });
    reviewState.workingDirectory = '/other';
    rerender(<AgentWorkingSidebar availableWidth={1601} />);
    expect(screen.getByLabelText('PR draft')).toHaveValue('');
  });

  it('opens a linked pull request from Overview in the Working Sidebar tab', () => {
    reviewState.repoType = 'github';
    reviewState.workingDirectory = '/repo';
    linkedPR.number = 42;
    linkedPR.status = 'ok';

    render(<AgentWorkingSidebar />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Pull Request from Overview' }));

    expect(globalStore.openWorkingSidebar).toHaveBeenCalledWith('pr');
    expect(screen.getByRole('button', { name: '#42' })).toHaveAttribute('aria-pressed', 'true');
  });

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
    localStorageState.openTabsByContext = { 'draft:agent:C:\\repo': ['review'] };

    const { unmount } = render(<AgentWorkingSidebar />);

    expect(rightPanel.current?.defaultWidth).toBe(560);
    expect(rightPanel.current?.width).toBe(560);
    expect(globalStore.updateSystemStatus).not.toHaveBeenCalled();

    unmount();
    globalStore.status.workingSidebarTab = 'params';
    localStorageState.openTabsByContext = { 'draft:agent:C:\\repo': ['params'] };
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

  // Regression: dragging the panel wide persisted a width that immediately
  // failed the fits check, so releasing the drag unmounted the whole sidebar —
  // and, with the too-wide value stored, it never came back at that window
  // size. A stored width beyond the row's budget must render clamped (and cap
  // further dragging) instead of hiding the panel.
  it('clamps a stored width that outgrew the row instead of hiding the panel', () => {
    globalStore.status.workingSidebarWidth = 1250;

    render(<AgentWorkingSidebar availableWidth={1540} />);

    expect(rightPanel.current?.expand).toBe(true);
    // 1540 - CONVERSATION_KEEP_WIDTH (420)
    expect(rightPanel.current?.width).toBe(1120);
    expect(rightPanel.current?.maxWidth).toBe(1120);
    // the clamp is render-only: the user's preference survives for wider rows
    expect(globalStore.updateSystemStatus).not.toHaveBeenCalled();
  });

  it('still yields the whole panel when even the minimum width leaves no room', () => {
    render(<AgentWorkingSidebar availableWidth={600} />);

    // 600 - 420 = 180 < the 300 minimum — nothing to clamp to, so it hides
    expect(rightPanel.current?.expand).toBe(false);
  });

  it('also yields the Overview card when the conversation width budget is too small', () => {
    globalStore.status.showRightPanel = false;

    render(<AgentWorkingSidebar availableWidth={600} />);

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('uses the Overview minimum width even when Review previously needed two panes', () => {
    agentStore.activeAgentId = 'agent';
    reviewState.repoType = 'git';
    reviewState.workingDirectory = '/repo';
    reviewState.showTree = true;
    localStorageState.openTabsByContext = { 'draft:agent:/repo': ['review'] };
    globalStore.status.workingSidebarTab = 'review';
    globalStore.status.showRightPanel = false;

    render(<AgentWorkingSidebar availableWidth={850} />);

    expect(screen.getByRole('complementary')).toBeInTheDocument();
  });

  it('keeps a fitting stored width untouched on a measured row', () => {
    render(<AgentWorkingSidebar availableWidth={1540} />);

    expect(rightPanel.current?.expand).toBe(true);
    expect(rightPanel.current?.width).toBe(360);
    expect(rightPanel.current?.maxWidth).toBe(1120);
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

  it('does not expose a persisted local workspace when the web client has no local runtime', () => {
    platform.isDesktop = false;
    agentStore.activeAgentId = 'agent';
    effectiveConfig.agencyConfig = { executionTarget: 'local' };
    reviewState.repoType = 'git';
    reviewState.workingDirectory = '/Users/me/project';
    globalStore.status.workingSidebarTab = 'works';

    render(<AgentWorkingSidebar />);

    expect(screen.queryByText('Workspace environment')).not.toBeInTheDocument();
    expect(screen.queryByText('/Users/me/project')).not.toBeInTheDocument();
    expect(filesProps.current).toBeUndefined();
  });
});

describe('Pull request Markdown', () => {
  it('renders standard Markdown without creating raw HTML elements', () => {
    const rawHtml = '<aside data-raw-html="true">raw HTML</aside>';
    const detail: DeviceGitPullRequestDetail = {
      additions: 1,
      author: 'lobehub',
      autoMerge: null,
      baseBehindBy: 0,
      baseRefName: 'canary',
      body: `**description-safe**\n\n${rawHtml}`,
      changedFiles: 1,
      checks: [],
      comments: [
        {
          author: 'contributor',
          body: `**comment-safe**\n\n${rawHtml}`,
          createdAt: '2026-09-24T00:00:00Z',
          id: 'comment-1',
        },
      ],
      commits: [],
      deletions: 0,
      headRefName: 'fix/markdown',
      headRefOid: 'a'.repeat(40),
      isCrossRepository: false,
      isDraft: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      number: 1,
      repo: { name: 'lobehub', owner: 'lobehub' },
      reviewDecision: null,
      reviews: [],
      state: 'open',
      title: 'Markdown rendering',
      url: 'https://github.com/lobehub/lobehub/pull/1',
      viewerCanBypass: false,
      viewerCanWrite: true,
    };

    const { container } = render(
      <PullRequestSections
        detail={detail}
        activity={{
          data: { comments: detail.comments, commits: [], reviews: [] },
          error: undefined,
          isValidating: false,
          mutate: vi.fn(),
        }}
        onAction={vi.fn().mockResolvedValue(true)}
        onOpenTab={vi.fn()}
      />,
    );

    expect(screen.getByText('description-safe', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('comment-safe', { selector: 'strong' })).toBeInTheDocument();
    expect(container.querySelector('[data-raw-html]')).not.toBeInTheDocument();
  });
});

describe('AgentWorkingSidebar — tab strip', () => {
  // Regression: at the 300px minimum panel width, labels such as “Deployments”
  // were allowed to shrink and wrap inside words. Tabs now stay on one line in a
  // horizontal strip, so a persisted tab near the end must be brought into view.
  it('scrolls the whole active tab, including its close button, into view', () => {
    globalStore.status.workingSidebarTab = 'params';
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return this instanceof HTMLDivElement &&
        this.firstElementChild instanceof HTMLButtonElement &&
        this.firstElementChild.getAttribute('aria-pressed') === 'true'
        ? ({
            left: 120 - (this.parentElement?.scrollLeft ?? 0),
            right: 222 - (this.parentElement?.scrollLeft ?? 0),
          } as DOMRect)
        : ({ left: 0, right: 200 } as DOMRect);
    });
    render(<AgentWorkingSidebar />);
    const paramsTab = screen.getByRole('button', { name: 'settingModel.params.panel.tab' });

    expect(paramsTab).toHaveAttribute('aria-pressed', 'true');
    expect(paramsTab.parentElement?.parentElement?.parentElement?.scrollLeft).toBe(22);
  });

  it('restores the complete active tab after the open menu closes and focus moves', async () => {
    globalStore.status.workingSidebarTab = 'params';
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return this instanceof HTMLDivElement &&
        this.firstElementChild instanceof HTMLButtonElement &&
        this.firstElementChild.getAttribute('aria-pressed') === 'true'
        ? ({
            left: 120 - (this.parentElement?.scrollLeft ?? 0),
            right: 222 - (this.parentElement?.scrollLeft ?? 0),
          } as DOMRect)
        : ({ left: 0, right: 200 } as DOMRect);
    });
    render(<AgentWorkingSidebar />);
    const paramsTab = screen.getByRole('button', { name: 'settingModel.params.panel.tab' });
    const tabs = paramsTab.parentElement?.parentElement?.parentElement;

    if (tabs) tabs.scrollLeft = 0;
    act(() => dropdownMenuState.onOpenChangeComplete?.(false));

    await waitFor(() => expect(tabs?.scrollLeft).toBe(22));
  });

  it('exposes and reveals a persisted active Works tab', () => {
    globalStore.status.workingSidebarTab = 'works';
    localStorageState.openTabsByContext = { 'draft:default:none': ['works'] };
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return this instanceof HTMLDivElement &&
        this.firstElementChild instanceof HTMLButtonElement &&
        this.firstElementChild.getAttribute('aria-pressed') === 'true'
        ? ({ left: 120, right: 222 } as DOMRect)
        : ({ left: 0, right: 200 } as DOMRect);
    });
    render(<AgentWorkingSidebar />);
    const worksTab = screen.getByRole('button', { name: 'workingPanel.works.title' });

    expect(worksTab).toHaveAttribute('aria-pressed', 'true');
    expect(worksTab.parentElement?.parentElement?.parentElement?.scrollLeft).toBe(22);
  });

  it('reveals the active tab again when an async tab becomes available', () => {
    agentStore.activeAgentId = 'agent';
    reviewState.workingDirectory = '/repo';
    globalStore.status.workingSidebarTab = 'params';
    localStorageState.openTabsByContext = { 'draft:agent:/repo': ['params', 'review'] };
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return this instanceof HTMLDivElement &&
        this.firstElementChild instanceof HTMLButtonElement &&
        this.firstElementChild.getAttribute('aria-pressed') === 'true'
        ? ({ left: 120, right: 222 } as DOMRect)
        : ({ left: 0, right: 200 } as DOMRect);
    });
    render(<AgentWorkingSidebar />);
    const paramsTab = screen.getByRole('button', { name: 'settingModel.params.panel.tab' });
    const tabs = paramsTab.parentElement?.parentElement?.parentElement;
    expect(tabs?.scrollLeft).toBe(22);

    act(() => reviewState.setRepoType?.('git'));

    expect(screen.getByRole('button', { name: 'workingPanel.review.title' })).toBeInTheDocument();
    expect(tabs?.scrollLeft).toBe(44);
  });

  it('renders business tabs after the built-in ones', () => {
    businessTabs.current = [
      { key: 'deployments', label: 'workingPanel.deployments.tab', pane: <div /> },
    ];
    localStorageState.openTabsByContext = {
      'draft:default:none': ['params', 'deployments'],
    };

    render(<AgentWorkingSidebar />);
    const labels = screen
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('aria-pressed'))
      .map((button) => button.textContent)
      .filter(Boolean);

    expect(labels).toEqual(['settingModel.params.panel.tab', 'workingPanel.deployments.tab']);
  });

  it('renders Overview as an independent reserved panel and hides unopened workspace tabs', () => {
    localStorageState.openTabsByContext = {};
    globalStore.status.showRightPanel = false;
    globalStore.status.workingSidebarTab = undefined;

    render(<AgentWorkingSidebar />);

    expect(screen.getByRole('complementary')).toHaveTextContent('Open Review from Overview');
    expect(screen.getByTestId('right-panel')).not.toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'workingPanel.resources.filter.skills' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'workingPanel.works.title' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the reserved Overview panel separate from the on-demand tab strip', () => {
    globalStore.status.showRightPanel = false;
    globalStore.status.workingSidebarTab = 'overview';
    render(<AgentWorkingSidebar />);

    expect(screen.getByRole('complementary')).toBeVisible();
    expect(screen.getByTestId('right-panel')).not.toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'workingPanel.openMenu.title' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the working panel chrome visible while the Params pane is suspended', () => {
    paramsSectionState.suspend = true;

    render(<AgentWorkingSidebar />);

    expect(screen.getByRole('complementary')).toHaveTextContent('Open Review from Overview');
    expect(screen.getByRole('button', { name: 'workingPanel.openMenu.title' })).toBeInTheDocument();
    expect(screen.getByTestId('params-loading')).toBeInTheDocument();
  });

  it('restores pinned tabs only for the agent that owns them', () => {
    agentStore.activeAgentId = 'agent-a';
    localStorageState.openTabsByContext = { 'draft:agent-a:none': [], 'draft:agent-b:none': [] };
    localStorageState.pinnedTabsByAgent = { 'agent-a': ['works'] };
    globalStore.status.workingSidebarTab = 'works';

    const { unmount } = render(<AgentWorkingSidebar />);
    const pinnedWorksTab = screen.getByRole('button', {
      hidden: true,
      name: 'workingPanel.works.title',
    });

    expect(pinnedWorksTab.parentElement).toHaveAttribute('data-pinned', 'true');
    expect(
      screen.queryByRole('button', { name: 'workingPanel.tabs.close' }),
    ).not.toBeInTheDocument();

    unmount();
    agentStore.activeAgentId = 'agent-b';
    render(<AgentWorkingSidebar />);

    expect(
      screen.queryByRole('button', { name: 'workingPanel.works.title' }),
    ).not.toBeInTheDocument();
  });

  it('pins and unpins a tab from its context menu', () => {
    agentStore.activeAgentId = 'agent';
    localStorageState.openTabsByContext = { 'draft:agent:none': ['params'] };
    globalStore.status.workingSidebarTab = 'params';

    render(<AgentWorkingSidebar />);
    const paramsTab = screen.getByRole('button', { name: 'settingModel.params.panel.tab' });

    fireEvent.contextMenu(paramsTab);
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.tabs.pin' }));

    expect(paramsTab.parentElement).toHaveAttribute('data-pinned', 'true');
    expect(screen.getByRole('button', { name: 'workingPanel.tabs.close' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.tabs.unpin' }));

    expect(paramsTab.parentElement).not.toHaveAttribute('data-pinned');
    expect(
      screen
        .getAllByRole('button', { name: 'workingPanel.tabs.close' })
        .some((button) => !button.hasAttribute('disabled')),
    ).toBe(true);
  });

  it('closes the current tab from its context menu', () => {
    agentStore.activeAgentId = 'agent';
    localStorageState.openTabsByContext = { 'draft:agent:none': ['params'] };
    globalStore.status.workingSidebarTab = 'params';

    render(<AgentWorkingSidebar />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'settingModel.params.panel.tab' }));
    fireEvent.click(screen.getByText('workingPanel.tabs.close'));

    expect(
      screen.queryByRole('button', { name: 'settingModel.params.panel.tab' }),
    ).not.toBeInTheDocument();
    expect(globalStore.setWorkingSidebarTab).toHaveBeenCalledWith('overview');
  });

  it('preserves the other implicit default tabs when one default tab closes', () => {
    localStorageState.openTabsByContext = {};
    globalStore.status.workingSidebarTab = 'skills';

    render(<AgentWorkingSidebar />);
    const skillsTab = screen.getByRole('button', {
      name: 'workingPanel.resources.filter.skills',
    });
    fireEvent.click(skillsTab.parentElement!.querySelector('[data-tab-close="true"]')!);

    expect(
      screen.queryByRole('button', { name: 'workingPanel.resources.filter.skills' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'workingPanel.resources.filter.documents' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(globalStore.toggleRightPanel).not.toHaveBeenCalled();
  });

  it('keeps the panel open and selects a surviving pinned tab when the active tab closes', () => {
    agentStore.activeAgentId = 'agent';
    localStorageState.openTabsByContext = { 'draft:agent:none': ['works', 'params'] };
    localStorageState.pinnedTabsByAgent = { agent: ['works'] };
    globalStore.status.workingSidebarTab = 'params';

    render(<AgentWorkingSidebar />);
    const paramsTab = screen.getByRole('button', { name: 'settingModel.params.panel.tab' });
    fireEvent.click(paramsTab.parentElement!.querySelector('[data-tab-close="true"]')!);

    expect(globalStore.setWorkingSidebarTab).toHaveBeenCalledWith('works');
    expect(globalStore.toggleRightPanel).not.toHaveBeenCalled();
  });

  it('preserves agent-pinned tabs when closing other tabs', () => {
    agentStore.activeAgentId = 'agent';
    localStorageState.openTabsByContext = {
      'draft:agent:none': ['skills', 'works', 'params'],
    };
    localStorageState.pinnedTabsByAgent = { agent: ['works'] };
    globalStore.status.workingSidebarTab = 'params';

    render(<AgentWorkingSidebar />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'settingModel.params.panel.tab' }));
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.tabs.closeOthers' }));

    expect(screen.getByRole('button', { name: 'workingPanel.works.title' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'workingPanel.resources.filter.skills' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'settingModel.params.panel.tab' }),
    ).toBeInTheDocument();
  });

  it('opens an available workspace tab once from the grouped menu', () => {
    agentStore.activeAgentId = 'agent';
    reviewState.repoType = 'git';
    reviewState.workingDirectory = '/repo';
    localStorageState.openTabsByContext = { 'draft:agent:/repo': ['params'] };
    globalStore.status.workingSidebarTab = 'params';

    render(<AgentWorkingSidebar />);

    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.openMenu.title' }));
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.review.title' }));

    expect(document.querySelectorAll('button[data-tab-key="review"]')).toHaveLength(1);
    expect(globalStore.openWorkingSidebar).toHaveBeenCalledWith('review');
  });

  it('mounts Review only while its visible tab is active', () => {
    agentStore.activeAgentId = 'agent';
    reviewState.repoType = 'git';
    reviewState.workingDirectory = '/repo';
    localStorageState.openTabsByContext = { 'draft:agent:/repo': ['params', 'review'] };
    globalStore.status.workingSidebarTab = 'params';

    render(<AgentWorkingSidebar />);

    expect(screen.queryByTestId('review')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.review.title' }));
    expect(screen.getByTestId('review')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'settingModel.params.panel.tab' }));
    expect(screen.queryByTestId('review')).not.toBeInTheDocument();
  });

  it('opens Skills and Documents by default for a new workspace context', () => {
    localStorageState.openTabsByContext = {};
    globalStore.status.workingSidebarTab = 'overview';

    render(<AgentWorkingSidebar />);

    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-tab-key]'));
    expect(tabs.map((tab) => tab.dataset.tabKey)).toEqual(['skills', 'documents']);
    expect(tabs[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('puts Files before Skills and Documents when a filesystem environment is available', () => {
    agentStore.activeAgentId = 'agent';
    effectiveConfig.agencyConfig = { executionTarget: 'local' };
    reviewState.workingDirectory = '/repo';
    localStorageState.openTabsByContext = {};
    globalStore.status.workingSidebarTab = 'overview';

    render(<AgentWorkingSidebar />);

    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-tab-key]'));
    expect(tabs.map((tab) => tab.dataset.tabKey)).toEqual(['files', 'skills', 'documents']);
    expect(tabs[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('creates an independent browser tab every time Browser is chosen', async () => {
    localStorageState.openTabsByContext = { 'draft:default:none': ['params'] };
    globalStore.status.workingSidebarTab = 'params';

    const { container } = render(<AgentWorkingSidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.openMenu.title' }));
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.browser.title' }));
    await waitFor(() => {
      expect(container.querySelectorAll('button[data-tab-key^="browser"]')).toHaveLength(1);
    });
    fireEvent.click(
      screen
        .getAllByRole('button', { name: 'workingPanel.browser.title' })
        .find((button) => !button.dataset.tabKey)!,
    );

    await waitFor(() => {
      expect(container.querySelectorAll('button[data-tab-key^="browser"]')).toHaveLength(2);
    });
    const sessionIds = [...new Set(browserPanes.current.map((pane) => pane.sessionId))];
    expect(sessionIds).toHaveLength(2);
    expect(sessionIds).toContain('draft-agent:default');
    expect(sessionIds.find((id) => id !== 'draft-agent:default')).toMatch(
      /^draft-agent:default:tab:/,
    );
  });

  it('routes Browser and Review context selections to the open portal thread', async () => {
    const agentId = 'agent';
    const topicId = 'topic';
    const threadId = 'thread';
    const expectedKey = messageMapKey({ agentId, threadId, topicId });
    agentStore.activeAgentId = agentId;
    chatStore.activeAgentId = agentId;
    chatStore.activeTopicId = topicId;
    chatStore.portalStack = [{ threadId, type: PortalViewType.Thread }];
    chatStore.showPortal = true;
    chatStore.threadMaps = { [topicId]: [{ agentId, id: threadId, topicId }] };
    reviewState.repoType = 'git';
    reviewState.workingDirectory = '/repo';
    localStorageState.openTabsByContext = { [`topic:${topicId}`]: ['browser'] };
    globalStore.status.workingSidebarTab = 'browser';

    render(<AgentWorkingSidebar />);

    await waitFor(() => expect(browserPanes.current.at(-1)).toBeDefined());
    expect(browserPanes.current.at(-1)?.composerTarget).toEqual({
      contextKey: expectedKey,
      writable: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open Review from Overview' }));
    await waitFor(() => expect(screen.getByTestId('review')).toBeInTheDocument());
    expect(renderedReview.current?.composerTarget).toEqual({
      contextKey: expectedKey,
      writable: true,
    });
  });

  it('marks Browser and Review context actions read-only for a subagent thread', async () => {
    const topicId = 'topic';
    const threadId = 'subagent-thread';
    chatStore.activeAgentId = 'agent';
    chatStore.activeTopicId = topicId;
    chatStore.portalStack = [{ threadId, type: PortalViewType.Thread }];
    chatStore.showPortal = true;
    chatStore.threadMaps = {
      [topicId]: [{ id: threadId, metadata: { sourceToolCallId: 'tool-call' }, topicId }],
    };
    reviewState.repoType = 'git';
    reviewState.workingDirectory = '/repo';
    localStorageState.openTabsByContext = { [`topic:${topicId}`]: ['browser'] };
    globalStore.status.workingSidebarTab = 'browser';

    render(<AgentWorkingSidebar />);

    await waitFor(() => expect(browserPanes.current.at(-1)).toBeDefined());
    expect(browserPanes.current.at(-1)?.composerTarget).toEqual({
      reason: 'read-only',
      writable: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open Review from Overview' }));
    await waitFor(() => expect(screen.getByTestId('review')).toBeInTheDocument());
    expect(renderedReview.current?.composerTarget).toEqual({
      reason: 'read-only',
      writable: false,
    });
  });

  it('uses browser page metadata for the tab title and favicon', async () => {
    localStorageState.openTabsByContext = { 'draft:default:none': ['browser'] };
    globalStore.status.workingSidebarTab = 'browser';

    const { container } = render(<AgentWorkingSidebar />);
    await waitFor(() => expect(browserPanes.current.at(-1)).toBeDefined());
    act(() => {
      browserPanes.current.at(-1)?.onMetadataChange?.({
        faviconUrl: 'https://example.com/favicon.ico',
        title: 'Example Domain',
        url: 'https://example.com',
      });
    });

    expect(screen.getByRole('button', { name: 'Example Domain' })).toBeInTheDocument();
    expect(
      container.querySelector('img[src="https://example.com/favicon.ico"]'),
    ).toBeInTheDocument();
  });

  it('preserves natural casing for grouped menu labels', () => {
    render(<AgentWorkingSidebar />);

    const groups = dropdownMenuState.items.filter((item) => item.type === 'group');

    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.label.props.style).toEqual({ textTransform: 'none' });
    }
  });

  it('moves focus to a tab opened from the grouped menu', async () => {
    agentStore.activeAgentId = 'agent';
    reviewState.repoType = 'git';
    reviewState.workingDirectory = '/repo';
    localStorageState.openTabsByContext = { 'draft:agent:/repo': ['review'] };
    globalStore.status.workingSidebarTab = 'review';
    globalStore.setWorkingSidebarTab.mockImplementation((tab: string) => {
      globalStore.status.workingSidebarTab = tab;
    });

    render(<AgentWorkingSidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.openMenu.title' }));
    fireEvent.click(screen.getByRole('button', { name: 'settingModel.params.panel.tab' }));

    await waitFor(
      () => {
        const paramsTab = screen
          .getAllByRole('button', { name: 'settingModel.params.panel.tab' })
          .find((button) => button.hasAttribute('aria-pressed'));
        expect(paramsTab).toHaveFocus();
      },
      { timeout: 1000 },
    );
  });

  it('returns to Overview when the active on-demand tab closes', () => {
    agentStore.activeAgentId = 'agent';
    reviewState.repoType = 'git';
    reviewState.workingDirectory = '/repo';
    localStorageState.openTabsByContext = { 'draft:agent:/repo': ['review'] };
    globalStore.status.workingSidebarTab = 'review';

    render(<AgentWorkingSidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.tabs.close' }));

    expect(globalStore.setWorkingSidebarTab).toHaveBeenCalledWith('overview');
  });

  it('still exposes empty workspace chrome after all tabs close and the panel reopens', () => {
    agentStore.activeAgentId = 'agent';
    reviewState.repoType = 'git';
    reviewState.workingDirectory = '/repo';
    localStorageState.openTabsByContext = { 'draft:agent:/repo': [] };
    globalStore.status.workingSidebarTab = 'overview';
    globalStore.status.showWorkingOverview = false;

    render(<AgentWorkingSidebar />);

    expect(rightPanel.current?.expand).toBe(true);
    expect(screen.getByRole('button', { name: 'workingPanel.openMenu.title' })).toBeInTheDocument();
  });

  it('clears an optimistic active tab when the topic context changes', async () => {
    chatStore.activeTopicId = 'topic-a';
    localStorageState.openTabsByContext = {
      'topic:topic-a': ['skills', 'params'],
      'topic:topic-b': ['skills'],
    };
    globalStore.status.workingSidebarTab = 'skills';

    const { rerender } = render(<AgentWorkingSidebar availableWidth={1000} />);
    fireEvent.click(screen.getByRole('button', { name: 'settingModel.params.panel.tab' }));

    chatStore.activeTopicId = 'topic-b';
    globalStore.status.workingSidebarTab = 'skills';
    rerender(<AgentWorkingSidebar availableWidth={1001} />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'workingPanel.resources.filter.skills' }),
      ).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('collapses the panel when the last remaining tab is closed', () => {
    agentStore.activeAgentId = 'agent';
    reviewState.repoType = 'git';
    reviewState.workingDirectory = '/repo';
    localStorageState.openTabsByContext = { 'draft:agent:/repo': ['review'] };
    globalStore.status.workingSidebarTab = 'review';

    render(<AgentWorkingSidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.tabs.close' }));

    expect(globalStore.toggleRightPanel).toHaveBeenCalledWith(false);
  });

  it('does not show Overview beside a legacy persisted open workspace panel', () => {
    globalStore.status.showRightPanel = true;
    globalStore.status.showWorkingOverview = undefined;

    render(<AgentWorkingSidebar />);

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(rightPanel.current?.expand).toBe(true);
  });

  it('reopens a closed tab when the same external target is requested again', async () => {
    agentStore.activeAgentId = 'agent';
    reviewState.repoType = undefined;
    reviewState.workingDirectory = '/repo';
    localStorageState.openTabsByContext = {};
    globalStore.status.workingSidebarTab = 'overview';

    render(<AgentWorkingSidebar />);
    expect(
      screen.queryByRole('button', { name: 'workingPanel.review.title' }),
    ).not.toBeInTheDocument();

    globalStore.status.workingSidebarTabRequest = { nonce: 1, tab: 'review' };
    act(() => reviewState.setRepoType?.('git'));
    await waitFor(() => {
      expect(document.querySelector('button[data-tab-key="review"]')).toBeInTheDocument();
    });

    fireEvent.click(document.querySelector('button[data-tab-key="review"]')!.nextElementSibling!);
    expect(document.querySelector('button[data-tab-key="review"]')).not.toBeInTheDocument();

    globalStore.status.workingSidebarTabRequest = { nonce: 2, tab: 'review' };
    act(() => reviewState.setRepoType?.('github'));
    await waitFor(() => {
      expect(document.querySelector('button[data-tab-key="review"]')).toBeInTheDocument();
    });
  });

  it('offers Comments for a workspace topic and opens it in this panel', () => {
    workspace.id = 'workspace-1';
    chatStore.activeTopicId = 'topic-1';
    localStorageState.openTabsByContext = { 'topic:topic-1': ['params'] };
    globalStore.status.workingSidebarTab = 'params';

    render(<AgentWorkingSidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.openMenu.title' }));
    const commentsItem = screen.getByRole('button', { name: 'topicComment.title' });

    fireEvent.click(commentsItem);

    expect(chatStore.openTopicComments).toHaveBeenCalledWith('topic-1');
  });

  it('hides Comments when there is no workspace topic', () => {
    localStorageState.openTabsByContext = { 'draft:default:none': ['params'] };
    globalStore.status.workingSidebarTab = 'params';

    render(<AgentWorkingSidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.openMenu.title' }));

    expect(screen.queryByRole('button', { name: 'topicComment.title' })).not.toBeInTheDocument();
  });
});
