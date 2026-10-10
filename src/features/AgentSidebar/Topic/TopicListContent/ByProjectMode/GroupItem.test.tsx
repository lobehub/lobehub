/**
 * @vitest-environment happy-dom
 */
import { AccordionRoot } from '@lobehub/ui';
import { fireEvent, render, screen } from '@testing-library/react';
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
      path?: string;
    }>,
);
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

vi.mock('@/features/Projects/WorkingDirectories/BindDirectoryModal', () => ({
  openBindDirectoryModal: vi.fn(),
}));

const openProjectTopicModalMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/Projects/WorkingDirectories/StartDirectoryModal', () => ({
  openProjectTopicModal: openProjectTopicModalMock,
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

vi.mock('@/store/chat', () => {
  const useChatStore = (selector: (state: object) => unknown) => selector({});
  useChatStore.getState = () => ({
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
  });

  it('opens the new-topic composer for the project directory without creating a topic', async () => {
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
    // The deferred row must still be born inside the project: the staged
    // directory rides along to the first-message creation.
    expect(setPendingNewTopicDirectoryMock).toHaveBeenCalledWith({
      agentId: 'agent-1',
      projectWorkingDirectoryId: 'binding-1',
    });
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
  // pre-committed for a multi-machine merged group.
  directoryRows.length = 0;
  openProjectTopicModalMock.mockClear();
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
    },
    {
      id: 'binding-multi-b',
      projectName: 'Multi Project',
      projectSlug: 'multi-project',
      projectId: 'prj-multi',
      projectAvatar: '📦',
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
  expect(openProjectTopicModalMock).not.toHaveBeenCalled();
  expect(commitAgentDefaultMock).not.toHaveBeenCalled();
  expect(switchTopicMock).toHaveBeenCalledWith(null, { skipRefreshMessage: true });
  expect(routerPushMock).toHaveBeenCalledWith('/agent/agent-1');
  // A multi-directory group has no single directory to stage — the user picks
  // the machine in the composer.
  expect(setPendingNewTopicDirectoryMock).not.toHaveBeenCalled();
});

it('keeps the legacy directory start when a project group has a single directory', async () => {
  directoryRows.length = 0;
  openProjectTopicModalMock.mockClear();
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
  expect(openProjectTopicModalMock).not.toHaveBeenCalled();
  expect(setPendingNewTopicDirectoryMock).toHaveBeenCalledWith({
    agentId: 'agent-1',
    projectWorkingDirectoryId: 'binding-single',
  });
});
