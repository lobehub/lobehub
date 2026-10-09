/**
 * @vitest-environment happy-dom
 */
import { AccordionRoot } from '@lobehub/ui/base-ui';
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

const directoryRows = vi.hoisted(
  () =>
    [] as Array<{
      id: string;
      projectName: string;
      projectSlug: string;
      projectId: string;
      projectAvatar: string;
    }>,
);
vi.mock('@/store/projectWorkingDirectory', () => ({
  useProjectDirectoryStore: (selector: (state: unknown) => unknown) =>
    selector({ useFetchDirectories: () => ({ hasData: true }) }),
  useProjectDirectories: () => directoryRows,
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => routerPushMock,
}));

vi.mock('@/features/Projects/WorkingDirectories/AgentDirectoryActions', () => ({
  AgentDirectoryActions: ({ onLegacyStart }: { onLegacyStart: () => Promise<void> }) => (
    <button aria-label="actions.addNewTopicInProject:project" onClick={onLegacyStart} />
  ),
}));

const openProjectTopicModalMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/Projects/WorkingDirectories/StartDirectoryModal', () => ({
  openProjectTopicModal: openProjectTopicModalMock,
}));

vi.mock('react-router', () => ({
  useParams: () => routeParamsMock,
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
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
  useChatStore.getState = () => ({ switchTopic: switchTopicMock });
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
    switchTopicMock.mockReset();
    routerPushMock.mockReset();
    routeParamsMock.aid = 'agent-1';
    agentStoreStateMock.activeAgentId = 'agent-1';
    activeWorkspaceSlugMock.value = 'lobehub';
  });

  it('navigates to a new chat topic after committing the project directory', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'actions.addNewTopicInProject:project' }));

    expect(commitAgentDefaultMock).toHaveBeenCalledWith('/Users/me/project');
    await expect.poll(() => routerPushMock.mock.calls.length).toBe(1);
    expect(switchTopicMock).toHaveBeenCalledWith(null, { skipRefreshMessage: true });
    expect(routerPushMock).toHaveBeenCalledWith('/agent/agent-1');
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

    fireEvent.click(screen.getByRole('button', { name: 'actions.addNewTopicInProject:project' }));

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

    fireEvent.click(screen.getByRole('button', { name: 'actions.addNewTopicInProject:project' }));

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

it('opens the execution-context chooser when a merged project group spans multiple directories', () => {
  // ROOT CAUSE: the merged project-id group used to start work silently in
  // the most recent directory's device. With several machines bound to one
  // project, the "+" must open the chooser (this machine / another computer /
  // conversation only) instead of guessing.
  directoryRows.length = 0;
  openProjectTopicModalMock.mockClear();
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
  expect(openProjectTopicModalMock).toHaveBeenCalledTimes(1);
  expect(openProjectTopicModalMock).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: 'prj-multi',
      coordinatorAgentId: 'agent-1',
      title: 'sidebar.newConversation',
    }),
  );
});

it('keeps the direct start action when a merged project group has a single directory', () => {
  directoryRows.length = 0;
  openProjectTopicModalMock.mockClear();
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
  expect(screen.queryByRole('button', { name: 'directories.start' })).not.toBeInTheDocument();
  expect(openProjectTopicModalMock).not.toHaveBeenCalled();
});
