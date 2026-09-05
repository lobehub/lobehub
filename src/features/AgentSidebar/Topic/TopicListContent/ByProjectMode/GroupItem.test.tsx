/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GroupItem from './GroupItem';

const commitAgentDefaultMock = vi.hoisted(() => vi.fn());
const switchTopicMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());
const routeParamsMock = vi.hoisted(() => ({ aid: 'agent-1' as string | undefined }));
const agentStoreStateMock = vi.hoisted(() => ({ activeAgentId: 'agent-1' as string | undefined }));
const activeWorkspaceSlugMock = vi.hoisted(() => ({ value: 'lobehub' as string | null }));

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
      <GroupItem
        expanded
        group={{
          children: [],
          id: 'project:/Users/me/project',
          title: 'project',
        }}
      />,
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
      <GroupItem
        expanded
        group={{
          children: [],
          id: 'project:/Users/me/project',
          title: 'project',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'actions.addNewTopicInProject:project' }));

    await expect.poll(() => routerPushMock.mock.calls.length).toBe(1);
    expect(routerPushMock).toHaveBeenCalledWith('/lobehub/agent/agent-1');
  });

  it('falls back to the pathname agent id when route params and store state are unavailable', () => {
    routeParamsMock.aid = undefined;
    agentStoreStateMock.activeAgentId = undefined;

    render(
      <GroupItem
        expanded
        group={{
          children: [],
          id: 'project:/Users/me/project',
          title: 'project',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'actions.addNewTopicInProject:project' }));

    expect(commitAgentDefaultMock).toHaveBeenCalledWith('/Users/me/project');
  });
});
