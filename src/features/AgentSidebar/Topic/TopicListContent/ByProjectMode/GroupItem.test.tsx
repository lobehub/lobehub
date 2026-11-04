/**
 * @vitest-environment happy-dom
 */
import { AccordionRoot } from '@lobehub/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TopicListScopeContext } from '../../TopicListScope';
import GroupItem from './GroupItem';

const commitAgentDefaultMock = vi.hoisted(() => vi.fn());
const switchTopicMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());
const routeParamsMock = vi.hoisted(() => ({ aid: 'agent-1' as string | undefined }));
const agentStoreStateMock = vi.hoisted(() => ({ activeAgentId: 'agent-1' as string | undefined }));
const activeWorkspaceSlugMock = vi.hoisted(() => ({ value: 'lobehub' as string | null }));

const startTopicMock = vi.hoisted(() => vi.fn());
const setPendingNewTopicDirectoryMock = vi.hoisted(() => vi.fn());
const directoryRows = vi.hoisted(
  () =>
    [] as Array<{
      id: string;
      projectName: string;
      projectSlug: string;
      projectId: string;
      projectAvatar: string;
      deviceId?: string;
      deviceName?: string;
      path?: string;
      environmentId?: string;
      instanceId?: string;
      permission?: string;
    }>,
);
const subGroupModeMock = vi.hoisted(() => ({ value: 'none' as string }));
const updateSystemStatusMock = vi.hoisted(() => vi.fn());
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: object) => unknown) =>
    selector({
      status: {
        projectTopicSubGroupModeByGroup: {
          'project-id:prj-1': subGroupModeMock.value,
          'project:/tmp/x': subGroupModeMock.value,
        },
      },
      updateSystemStatus: updateSystemStatusMock,
    }),
}));

vi.mock('@/store/device', () => ({
  deviceSelectors: { deviceList: (s: { devices: unknown[] }) => s.devices },
  useDeviceStore: (selector: (state: object) => unknown) =>
    selector({
      devices: [{ deviceId: 'device-2', friendlyName: 'Studio Linux' }],
      useFetchDevices: () => ({}),
    }),
}));

vi.mock('@/store/projectWorkingDirectory', () => ({
  useProjectDirectoryStore: (selector: (state: unknown) => unknown) =>
    selector({
      startTopic: startTopicMock,
      useFetchDirectories: () => ({ error: undefined, hasData: true }),
    }),
  useProjectDirectories: () => directoryRows,
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => routerPushMock,
}));

vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => ({
    agencyConfig: { boundDeviceId: 'device-1' },
    workspaceScoped: false,
  }),
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: unknown) => unknown) =>
    selector({ gatewayDeviceInfo: { deviceId: 'device-1' } }),
}));

vi.mock('@/helpers/agentWorkingDirectory', () => ({
  resolveTargetDeviceId: () => 'device-1',
}));

const openBindDirectoryModalMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/Projects/WorkingDirectories/BindDirectoryModal', () => ({
  openBindDirectoryModal: openBindDirectoryModalMock,
}));

vi.mock('react-router', () => ({
  useParams: () => routeParamsMock,
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { directory?: string }) =>
      options?.directory ? `${key}:${options.directory}` : key,
  }),
}));

vi.mock('@/components/RingLoading', () => ({
  default: () => <span />,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => activeWorkspaceSlugMock.value,
}));

vi.mock('@/const/version', () => ({ isDesktop: true }));

vi.mock('@/features/ChatInput/ControlBar/useCommitWorkingDirectory', () => ({
  useCommitWorkingDirectory: () => ({
    commitAgentDefault: commitAgentDefaultMock,
  }),
}));

vi.mock('@/helpers/executionTarget', () => ({
  resolveExecutionTarget: () => 'device',
}));

vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: () => ({
    push: routerPushMock,
  }),
}));

vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ hash: '', pathname: '/lobehub/agent/agent-1/profile', search: '' }),
}));

vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => agentStoreStateMock,
  useAgentStore: (selector: (state: { activeAgentId?: string }) => unknown) =>
    selector(agentStoreStateMock),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: () => () => ({ boundDeviceId: 'device-1' }),
    isAgentHeterogeneousById: () => () => true,
    isWorkspaceAgentById: () => () => false,
  },
  agentSelectors: {
    getAgentConfigById: () => () => undefined,
  },
}));

const updateTopicStatusMock = vi.hoisted(() => vi.fn());
const refreshTopicMock = vi.hoisted(() => vi.fn());
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => undefined,
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({
  preferenceSelectors: { topicSortBy: () => 'updatedAt' },
  userProfileSelectors: { userId: () => 'user-1' },
}));

vi.mock('@/store/chat', () => {
  const useChatStore = (selector: (state: object) => unknown) => selector({});
  useChatStore.getState = () => ({
    refreshTopic: refreshTopicMock,
    updateTopicStatus: updateTopicStatusMock,
    setPendingNewTopicDirectory: setPendingNewTopicDirectoryMock,
    switchTopic: switchTopicMock,
  });
  return { useChatStore };
});

vi.mock('@/store/chat/selectors', () => ({
  operationSelectors: {
    unreadCompletedCountForTopics: () => () => 0,
    visiblyRunningTopicIds: () => new Set<string>(),
  },
}));

vi.mock('../../List/Item', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

describe('Project topic group item', () => {
  beforeEach(() => {
    directoryRows.length = 0;
    commitAgentDefaultMock.mockReset();
    startTopicMock.mockReset();
    setPendingNewTopicDirectoryMock.mockReset();
    switchTopicMock.mockReset();
    routerPushMock.mockReset();
    routeParamsMock.aid = 'agent-1';
    agentStoreStateMock.activeAgentId = 'agent-1';
    activeWorkspaceSlugMock.value = 'lobehub';
    subGroupModeMock.value = 'none';
    updateTopicStatusMock.mockReset();
    refreshTopicMock.mockReset();
  });

  it('keeps the sub-group menu when the newest project topic has no working directory', () => {
    // Without a directory the add-topic actions can't render; the grouping
    // choice must not disappear with them.
    render(
      <AccordionRoot>
        <GroupItem
          expanded
          group={{
            children: [{ id: 't1', title: 'Conversation only' }] as any,
            id: 'project-id:prj-1',
            title: 'LobeHub',
          }}
        />
      </AccordionRoot>,
    );

    expect(screen.queryByRole('button', { name: 'directories.start' })).toBeNull();
    expect(screen.getByRole('button', { name: 'topics.subGroup.title' })).toBeTruthy();
  });

  it('picks a sub-group mode from the row grouping button and remembers it per group', async () => {
    updateSystemStatusMock.mockReset();
    render(
      <AccordionRoot>
        <GroupItem
          expanded
          group={{
            children: [{ id: 't1', title: 'Topic' }] as any,
            id: 'project-id:prj-1',
            title: 'LobeHub',
          }}
        />
      </AccordionRoot>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'topics.subGroup.title' }));
    fireEvent.click(await screen.findByText('topics.subGroup.byDevice'));

    expect(updateSystemStatusMock).toHaveBeenCalledWith({
      projectTopicSubGroupModeByGroup: { 'project-id:prj-1': 'byDevice' },
    });
  });

  it('sections a project group by device when that mode is picked', () => {
    subGroupModeMock.value = 'byDevice';
    directoryRows.push(
      {
        deviceId: 'device-1',
        deviceName: 'MacBook',
        id: 'binding-mac',
        path: '/Users/me/project',
        projectAvatar: '',
        projectId: 'prj-1',
        projectName: 'LobeHub',
        projectSlug: 'lobehub',
      },
      {
        deviceId: 'device-2',
        id: 'binding-linux',
        path: '/home/me/project',
        projectAvatar: '',
        projectId: 'prj-1',
        projectName: 'LobeHub',
        projectSlug: 'lobehub',
      },
    );

    render(
      <AccordionRoot defaultValue={['project-id:prj-1']}>
        <GroupItem
          expanded
          group={{
            children: [
              { id: 't1', projectWorkingDirectoryId: 'binding-linux', title: 'Linux topic' },
              { id: 't2', title: 'Loose topic' },
              { id: 't3', projectWorkingDirectoryId: 'binding-mac', title: 'Mac topic' },
            ] as any,
            id: 'project-id:prj-1',
            title: 'LobeHub',
          }}
        />
      </AccordionRoot>,
    );

    const order = ['Studio Linux', 'Linux topic', 'MacBook', 'Mac topic'];
    const text = document.body.textContent ?? '';
    order.reduce((from, label) => {
      const at = text.indexOf(label, from);
      expect(at, label).toBeGreaterThanOrEqual(from);
      return at;
    }, 0);
    expect(text.indexOf('groupTitle.byDevice.unknown')).toBeLessThan(text.indexOf('Loose topic'));
    expect(text.indexOf('Mac topic')).toBeLessThan(text.indexOf('groupTitle.byDevice.unknown'));
  });

  it('offers no device grouping for a plain folder group and ignores a stale byDevice choice', async () => {
    subGroupModeMock.value = 'byDevice';
    render(
      <AccordionRoot defaultValue={['project:/tmp/x']}>
        <GroupItem
          expanded
          group={{
            // A path-only group: no project id, no bound directory.
            children: [
              { id: 't1', metadata: { workingDirectory: '/tmp/x' }, title: 'Folder topic' },
            ] as any,
            id: 'project:/tmp/x',
            title: '/tmp/x',
          }}
        />
      </AccordionRoot>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'topics.subGroup.title' }));
    expect(await screen.findByText('topics.subGroup.byTime')).toBeTruthy();
    expect(screen.queryByText('topics.subGroup.byDevice')).toBeNull();
    expect(document.body.textContent).not.toContain('groupTitle.byDevice.unknown');
  });

  it('archives only this group\'s merged-PR topics from the group "more" menu', async () => {
    const merged = { github: { pullRequest: { mergedAt: '2026-10-01', state: 'closed' } } };
    render(
      <AccordionRoot>
        <GroupItem
          expanded
          group={{
            children: [
              {
                id: 't-merged',
                metadata: { workingDirectory: '/tmp/x', workingDirectoryConfig: { git: merged } },
                title: 'Merged',
              },
              {
                id: 't-done',
                metadata: { workingDirectory: '/tmp/x', workingDirectoryConfig: { git: merged } },
                status: 'completed',
                title: 'Already done',
              },
              { id: 't-open', metadata: { workingDirectory: '/tmp/x' }, title: 'Open' },
            ] as any,
            id: 'project:/tmp/x',
            title: '/tmp/x',
          }}
        />
      </AccordionRoot>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'directories.projectBinding' }));
    fireEvent.click(await screen.findByText('actions.archiveMergedPullRequests'));

    await waitFor(() => expect(refreshTopicMock).toHaveBeenCalled());
    expect(updateTopicStatusMock).toHaveBeenCalledTimes(1);
    expect(updateTopicStatusMock).toHaveBeenCalledWith({
      status: 'completed',
      topicId: 't-merged',
    });
  });

  it('folds a device section from its header without touching the others', async () => {
    subGroupModeMock.value = 'byDevice';
    directoryRows.push({
      deviceId: 'device-2',
      id: 'binding-linux',
      path: '/home/me/project',
      projectAvatar: '',
      projectId: 'prj-1',
      projectName: 'LobeHub',
      projectSlug: 'lobehub',
    });

    render(
      <AccordionRoot defaultValue={['project-id:prj-1']}>
        <GroupItem
          expanded
          group={{
            children: [
              { id: 't1', projectWorkingDirectoryId: 'binding-linux', title: 'Linux topic' },
              { id: 't2', title: 'Loose topic' },
            ] as any,
            id: 'project-id:prj-1',
            title: 'LobeHub',
          }}
        />
      </AccordionRoot>,
    );

    expect(screen.getByText('Linux topic')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Studio Linux' }));

    await waitFor(() => expect(screen.queryByText('Linux topic')).toBeNull());
    expect(screen.getByText('Loose topic')).toBeTruthy();
  });

  it('starts a new topic in the project directory of a device section from its "+"', () => {
    subGroupModeMock.value = 'byDevice';
    directoryRows.push(
      {
        deviceId: 'device-1',
        deviceName: 'MacBook',
        environmentId: 'env-1',
        id: 'binding-mac',
        instanceId: 'ins-mac',
        path: '/Users/me/project',
        permission: 'readWrite',
        runnable: true,
        projectAvatar: '',
        projectId: 'prj-1',
        projectName: 'LobeHub',
        projectSlug: 'lobehub',
      },
      {
        deviceId: 'device-2',
        environmentId: 'env-1',
        id: 'binding-linux',
        instanceId: 'ins-linux',
        path: '/home/me/project',
        permission: 'readWrite',
        runnable: true,
        projectAvatar: '',
        projectId: 'prj-1',
        projectName: 'LobeHub',
        projectSlug: 'lobehub',
      },
      // A read-only directory on a third device cannot start a run, so it must
      // not seed an empty device section with a "+".
      {
        deviceId: 'device-3',
        environmentId: 'env-1',
        id: 'binding-readonly',
        instanceId: 'ins-readonly',
        path: '/srv/project',
        permission: 'readOnly',
        runnable: false,
        projectAvatar: '',
        projectId: 'prj-1',
        projectName: 'LobeHub',
        projectSlug: 'lobehub',
      },
    );

    render(
      <AccordionRoot defaultValue={['project-id:prj-1']}>
        <GroupItem
          expanded
          group={{
            children: [
              { id: 't1', projectWorkingDirectoryId: 'binding-linux', title: 'Linux topic' },
              { id: 't2', title: 'Loose topic' },
            ] as any,
            id: 'project-id:prj-1',
            title: 'LobeHub',
          }}
        />
      </AccordionRoot>,
    );

    // Both runnable device sections get a "+" — the MacBook one is listed
    // empty so a topic can start there — while the read-only device gets no
    // section and the unknown section has no directory to start in (and the
    // group header has no path, so it renders none). The Linux section comes
    // first because it has the newest topic.
    const starts = screen.getAllByRole('button', { name: 'directories.start' });
    expect(starts).toHaveLength(2);
    fireEvent.click(starts[0]);

    expect(commitAgentDefaultMock).not.toHaveBeenCalled();
    expect(switchTopicMock).toHaveBeenCalledWith(null, { skipRefreshMessage: true });
    expect(setPendingNewTopicDirectoryMock).toHaveBeenCalledWith({
      agentId: 'agent-1',
      projectWorkingDirectoryId: 'binding-linux',
    });
    expect(routerPushMock).toHaveBeenCalled();
  });

  it('opens a path-only composer from a path group even when a project registered that path', async () => {
    // The group "+" must not persist anything: it opens the composer, and the
    // topic is created once the user sends the first message. Regression for
    // the straight-to-server start that dropped an empty "untitled" topic into
    // the project on the click itself.
    directoryRows.push({
      deviceId: 'device-1',
      id: 'binding-1',
      path: '/Users/me/project',
      projectId: 'prj-1',
      projectName: 'LobeHub',
      projectSlug: 'lobehub',
    });
    commitAgentDefaultMock.mockResolvedValue(undefined);

    render(
      <AccordionRoot>
        <GroupItem
          expanded
          group={{
            children: [],
            id: 'project:/Users/me/project',
            title: 'project',
          }}
        />
      </AccordionRoot>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'directories.start' }));

    expect(commitAgentDefaultMock).toHaveBeenCalledWith('/Users/me/project');
    await expect.poll(() => routerPushMock.mock.calls.length).toBe(1);
    expect(switchTopicMock).toHaveBeenCalledWith(null, { skipRefreshMessage: true });
    expect(routerPushMock).toHaveBeenCalledWith('/agent/agent-1');
    expect(startTopicMock).not.toHaveBeenCalled();
    // A plain path group stays path-only: a project directory registered at
    // the same path must not pull the new topic into that project.
    expect(setPendingNewTopicDirectoryMock).toHaveBeenCalledWith(undefined);
  });

  it('offers binding a path group even when a project registered that path', async () => {
    directoryRows.push({
      deviceId: 'device-1',
      id: 'binding-1',
      path: '/Users/me/project',
      projectAvatar: '',
      projectId: 'prj-1',
      projectName: 'LobeHub',
      projectSlug: 'lobehub',
    });
    openBindDirectoryModalMock.mockReset();

    render(
      <AccordionRoot>
        <GroupItem
          expanded
          group={{
            children: [
              { id: 't1', metadata: { workingDirectory: '/Users/me/project' }, title: 'Loose' },
            ] as any,
            id: 'project:/Users/me/project',
            title: 'project',
          }}
        />
      </AccordionRoot>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'directories.projectBinding' }));
    expect(screen.queryByText('topics.viewProject')).toBeNull();
    fireEvent.click(await screen.findByText('directories.bind'));

    expect(openBindDirectoryModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'device-1',
        path: '/Users/me/project',
        topicIds: ['t1'],
      }),
    );
  });

  it('preserves the detected route prefix when adding a project topic without an active workspace slug', async () => {
    activeWorkspaceSlugMock.value = null;
    commitAgentDefaultMock.mockResolvedValue(undefined);

    render(
      <AccordionRoot>
        <GroupItem
          expanded
          group={{
            children: [],
            id: 'project:/Users/me/project',
            title: 'project',
          }}
        />
      </AccordionRoot>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'directories.start' }));

    await expect.poll(() => routerPushMock.mock.calls.length).toBe(1);
    expect(routerPushMock).toHaveBeenCalledWith('/lobehub/agent/agent-1');
  });

  it('falls back to the pathname agent id when route params and store state are unavailable', () => {
    routeParamsMock.aid = undefined;
    agentStoreStateMock.activeAgentId = undefined;

    render(
      <AccordionRoot>
        <GroupItem
          expanded
          group={{
            children: [],
            id: 'project:/Users/me/project',
            title: 'project',
          }}
        />
      </AccordionRoot>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'directories.start' }));

    expect(commitAgentDefaultMock).toHaveBeenCalledWith('/Users/me/project');
  });
});

it('uses the bound project name and lets the user jump directly to that project', () => {
  directoryRows.push({
    id: 'binding-1',
    projectName: 'Shared Project',
    projectSlug: 'shared-project',
    projectId: 'prj-1',
    projectAvatar: '📦',
  });
  render(
    <AccordionRoot defaultValue={['project:/repo']}>
      <GroupItem
        expanded
        group={{
          id: 'project:/repo',
          title: 'repo',
          children: [
            {
              id: 'topic-1',
              title: 'Work',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              projectWorkingDirectoryId: 'binding-1',
              metadata: { workingDirectory: '/repo' },
            },
          ],
        }}
      />
    </AccordionRoot>,
  );
  fireEvent.click(screen.getByRole('link', { name: 'Shared Project' }));
  expect(routerPushMock).toHaveBeenCalledWith('/project/shared-project');
});

it('keeps the workspace scope in the project link and leaves modified clicks to the browser', () => {
  activeWorkspaceSlugMock.value = 'lobehub';
  routerPushMock.mockClear();
  directoryRows.push({
    id: 'binding-2',
    projectName: 'Workspace Project',
    projectSlug: 'workspace-project',
    projectId: 'prj-2',
    projectAvatar: '📦',
  });
  render(
    <AccordionRoot defaultValue={['project:/repo-ws']}>
      <GroupItem
        expanded
        group={{
          id: 'project:/repo-ws',
          title: 'repo-ws',
          children: [
            {
              id: 'topic-ws',
              title: 'Work',
              createdAt: 1,
              updatedAt: 1,
              projectWorkingDirectoryId: 'binding-2',
              metadata: { workingDirectory: '/repo-ws' },
            },
          ],
        }}
      />
    </AccordionRoot>,
  );
  const link = screen.getByRole('link', { name: 'Workspace Project' });
  expect(link).toHaveAttribute('href', '/lobehub/project/workspace-project');

  // fireEvent returns false when the default action was prevented.
  expect(fireEvent.click(link, { metaKey: true })).toBe(true);
  expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
  expect(routerPushMock).not.toHaveBeenCalled();
});

it('shows the directory title inside Project scope rather than repeating the project name', () => {
  directoryRows.push({
    id: 'binding-scoped',
    projectName: 'Shared Project',
    projectSlug: 'shared-project',
    projectId: 'prj-1',
    projectAvatar: '📦',
  });
  render(
    <TopicListScopeContext value={{ projectId: 'prj-1' }}>
      <AccordionRoot defaultValue={['project:/repo-a']}>
        <GroupItem
          expanded
          group={{
            id: 'project:/repo-a',
            title: 'repo-a',
            children: [
              {
                id: 'topic-scoped',
                title: 'Work',
                createdAt: 1,
                updatedAt: 1,
                projectWorkingDirectoryId: 'binding-scoped',
                metadata: { workingDirectory: '/repo-a' },
              },
            ],
          }}
        />
      </AccordionRoot>
    </TopicListScopeContext>,
  );
  expect(screen.getByText('repo-a')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Shared Project' })).not.toBeInTheDocument();
});

it('resolves a merged project group through any directory of that project', () => {
  // Merged `project-id:` groups span several directories of one project, and
  // their most recent topic may not name a directory at all — the project
  // identity must come from the group id, not from the first child's directory.
  directoryRows.push(
    {
      id: 'binding-a',
      projectName: 'LobeHub',
      projectSlug: 'lobehub',
      projectId: 'prj-merged',
      projectAvatar: '📦',
    },
    {
      id: 'binding-b',
      projectName: 'LobeHub',
      projectSlug: 'lobehub',
      projectId: 'prj-merged',
      projectAvatar: '📦',
    },
  );
  render(
    <AccordionRoot defaultValue={['project-id:prj-merged']}>
      <GroupItem
        expanded
        group={{
          id: 'project-id:prj-merged',
          title: 'lobehub',
          children: [
            {
              id: 'topic-conversation-only',
              title: 'Chat',
              createdAt: 3,
              updatedAt: 3,
              projectId: 'prj-merged',
            },
            {
              id: 'topic-directory',
              title: 'Work',
              createdAt: 2,
              updatedAt: 2,
              projectId: 'prj-merged',
              projectWorkingDirectoryId: 'binding-b',
              metadata: { workingDirectory: '/other/lobehub' },
            },
          ],
        }}
      />
    </AccordionRoot>,
  );
  fireEvent.click(screen.getByRole('link', { name: 'LobeHub' }));
  expect(routerPushMock).toHaveBeenCalledWith('/project/lobehub');
});

it('opens the plain new-topic composer when a merged project group spans multiple directories', () => {
  // ROOT CAUSE: the first fix opened a chooser modal here, but the expected
  // habit is the plain new-topic composer — the user picks the machine in the
  // composer control bar, so no modal may pop and no directory default may be
  // committed to the agent for a multi-machine merged group.
  directoryRows.length = 0;
  commitAgentDefaultMock.mockClear();
  switchTopicMock.mockClear();
  setPendingNewTopicDirectoryMock.mockClear();
  routerPushMock.mockClear();
  directoryRows.push(
    {
      id: 'binding-multi-a',
      projectName: 'Multi Project',
      projectSlug: 'multi-project',
      projectId: 'prj-multi',
      projectAvatar: '📦',
      deviceId: 'device-2',
      environmentId: 'env-a',
      instanceId: 'inst-a',
      permission: 'readWrite',
    },
    {
      id: 'binding-multi-b',
      projectName: 'Multi Project',
      projectSlug: 'multi-project',
      projectId: 'prj-multi',
      projectAvatar: '📦',
      deviceId: 'device-1',
      environmentId: 'env-b',
      instanceId: 'inst-b',
      permission: 'readWrite',
    },
  );
  render(
    <AccordionRoot defaultValue={['project-id:prj-multi']}>
      <GroupItem
        expanded
        group={{
          id: 'project-id:prj-multi',
          title: 'multi',
          children: [
            {
              id: 'topic-multi-a',
              title: 'Work A',
              createdAt: 2,
              updatedAt: 2,
              projectId: 'prj-multi',
              projectWorkingDirectoryId: 'binding-multi-a',
              metadata: { workingDirectory: '/repo-a' },
            },
            {
              id: 'topic-multi-b',
              title: 'Work B',
              createdAt: 1,
              updatedAt: 1,
              projectId: 'prj-multi',
              projectWorkingDirectoryId: 'binding-multi-b',
              metadata: { workingDirectory: '/repo-b' },
            },
          ],
        }}
      />
    </AccordionRoot>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'directories.start' }));
  expect(commitAgentDefaultMock).not.toHaveBeenCalled();
  expect(switchTopicMock).toHaveBeenCalledWith(null, { skipRefreshMessage: true });
  expect(routerPushMock).toHaveBeenCalledWith('/agent/agent-1');
  // ROOT CAUSE of the detached topic: nothing was staged, so the first send
  // created a path-only conversation outside the project. The agent's current
  // device (device-1) wins; the composer's device switcher can move it.
  expect(setPendingNewTopicDirectoryMock).toHaveBeenCalledWith({
    agentId: 'agent-1',
    projectWorkingDirectoryId: 'binding-multi-b',
  });
});

it('keeps the legacy directory start when a project group has a single directory', async () => {
  directoryRows.length = 0;
  commitAgentDefaultMock.mockClear();
  commitAgentDefaultMock.mockResolvedValue(undefined);
  startTopicMock.mockClear();
  routerPushMock.mockClear();
  directoryRows.push({
    id: 'binding-single',
    projectName: 'Single Project',
    projectSlug: 'single-project',
    projectId: 'prj-single',
    projectAvatar: '📦',
  });
  render(
    <AccordionRoot defaultValue={['project-id:prj-single']}>
      <GroupItem
        expanded
        group={{
          id: 'project-id:prj-single',
          title: 'single',
          children: [
            {
              id: 'topic-single',
              title: 'Work',
              createdAt: 1,
              updatedAt: 1,
              projectId: 'prj-single',
              projectWorkingDirectoryId: 'binding-single',
              metadata: { workingDirectory: '/repo' },
            },
          ],
        }}
      />
    </AccordionRoot>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'directories.start' }));

  await expect.poll(() => commitAgentDefaultMock.mock.calls.length).toBe(1);
  expect(commitAgentDefaultMock).toHaveBeenCalledWith('/repo');
  expect(startTopicMock).not.toHaveBeenCalled();
  expect(setPendingNewTopicDirectoryMock).toHaveBeenCalledWith({
    agentId: 'agent-1',
    projectWorkingDirectoryId: 'binding-single',
  });
});
