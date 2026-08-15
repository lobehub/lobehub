/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Nav from './Nav';

const mutateMock = vi.hoisted(() => vi.fn());
const openNewTopicOrSaveTopicMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());
const switchTopicMock = vi.hoisted(() => vi.fn());
const toggleCommandMenuMock = vi.hoisted(() => vi.fn());
const useParamsMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const permissionMock = vi.hoisted(() => ({
  create_content: true,
  edit_own_content: true,
}));
vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => ({ canEditResource: true, isAccessResolved: true }),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock('@lobehub/ui/icons', () => ({
  BotPromptIcon: () => null,
}));

vi.mock('lucide-react', () => ({
  ListTodoIcon: () => null,
  MessageSquarePlusIcon: () => null,
  MessagesSquareIcon: () => null,
  SearchIcon: () => null,
  TargetIcon: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await vi.importActual('react-router')) as typeof import('react-router');

  return {
    ...actual,
    useParams: useParamsMock,
  };
});

vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({
    active,
    disabled,
    onClick,
    title,
  }: {
    active?: boolean;
    disabled?: boolean;
    onClick?: () => void;
    title: ReactNode;
  }) => (
    <button data-active={String(active)} disabled={disabled} type="button" onClick={onClick}>
      {title}
    </button>
  ),
}));

vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: () => ({
    push: pushMock,
  }),
}));

vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ hash: '', pathname: usePathnameMock(), search: '' }),
}));

vi.mock('@/libs/swr', () => ({
  useActionSWR: () => ({
    mutate: mutateMock,
  }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: keyof typeof permissionMock) => ({
    allowed: permissionMock[action],
    reason: permissionMock[action] ? '' : 'requires member',
  }),
}));

// Nav no longer reads the agent store, but its transitive imports pull it in —
// and the real module drags `lucide-react` icon internals through this file's
// icon mock. Keep the stub so the module graph stays inert here.
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: Record<string, unknown>) => unknown) => selector({}),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (
    selector: (state: {
      openNewTopicOrSaveTopic: () => void;
      switchTopic: (topicId: string | null, options?: unknown) => void;
    }) => unknown,
  ) =>
    selector({
      openNewTopicOrSaveTopic: openNewTopicOrSaveTopicMock,
      switchTopic: switchTopicMock,
    }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: { toggleCommandMenu: (open: boolean) => void }) => unknown) =>
    selector({ toggleCommandMenu: toggleCommandMenuMock }),
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: (state: { featureFlags: { isAgentEditable: boolean } }) =>
    state.featureFlags,
  useServerConfigStore: (
    selector: (state: { featureFlags: { isAgentEditable: boolean } }) => unknown,
  ) => selector({ featureFlags: { isAgentEditable: true } }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) =>
    selector({ preference: { lab: { enableTopicAcceptance: true } } }),
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: {
    enableTopicAcceptance: (state: { preference: { lab?: { enableTopicAcceptance?: boolean } } }) =>
      state.preference.lab?.enableTopicAcceptance ?? false,
  },
}));

describe('Agent sidebar header nav', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    openNewTopicOrSaveTopicMock.mockReset();
    pushMock.mockReset();
    switchTopicMock.mockReset();
    toggleCommandMenuMock.mockReset();
    useParamsMock.mockReset();
    usePathnameMock.mockReset();
    permissionMock.create_content = true;
    permissionMock.edit_own_content = true;

    useParamsMock.mockReturnValue({ aid: 'agt_eH4zL98zBx5u', topicId: 'tpc_2FCHvjS7d4CA' });
  });

  it('returns to the agent chat route before opening a new topic from a topic page document route', () => {
    usePathnameMock.mockReturnValue(
      '/agent/agt_eH4zL98zBx5u/tpc_2FCHvjS7d4CA/page/docs_9B8hFkmEOZyPZb60',
    );

    render(<Nav />);

    fireEvent.click(screen.getByRole('button', { name: 'actions.addNewTopic' }));

    expect(pushMock).toHaveBeenCalledWith('/agent/agt_eH4zL98zBx5u');
    expect(mutateMock).toHaveBeenCalledTimes(1);
  });

  it('pushes the agent chat route even when already on it', () => {
    usePathnameMock.mockReturnValue('/agent/agt_eH4zL98zBx5u');

    render(<Nav />);

    fireEvent.click(screen.getByRole('button', { name: 'actions.addNewTopic' }));

    expect(pushMock).toHaveBeenCalledWith('/agent/agt_eH4zL98zBx5u');
    expect(mutateMock).toHaveBeenCalledTimes(1);
  });

  it('disables starting a new topic for workspace viewers', () => {
    permissionMock.create_content = false;
    usePathnameMock.mockReturnValue('/agent/agt_eH4zL98zBx5u/channel');

    render(<Nav />);

    const startButton = screen.getByRole('button', { name: 'actions.addNewTopic' });
    expect(startButton).toBeDisabled();

    fireEvent.click(startButton);

    expect(pushMock).not.toHaveBeenCalled();
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('no longer offers a standalone message channels entry', () => {
    usePathnameMock.mockReturnValue('/agent/agt_eH4zL98zBx5u');

    render(<Nav />);

    expect(screen.queryByRole('button', { name: 'tab.integration' })).not.toBeInTheDocument();
  });

  it.each([
    ['/agent/agt_eH4zL98zBx5u/profile'],
    ['/agent/agt_eH4zL98zBx5u/channel'],
    ['/agent/agt_eH4zL98zBx5u/channel/slack'],
    ['/agent/agt_eH4zL98zBx5u/statistics'],
  ])('keeps the profile entry active on %s', (pathname) => {
    usePathnameMock.mockReturnValue(pathname);

    render(<Nav />);

    expect(screen.getByRole('button', { name: 'tab.profile' })).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  it('navigates to the agent goals page', () => {
    usePathnameMock.mockReturnValue('/agent/agt_eH4zL98zBx5u');

    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: 'goalList.title' }));

    expect(switchTopicMock).toHaveBeenCalledWith(null, { skipRefreshMessage: true });
    expect(pushMock).toHaveBeenCalledWith('/agent/agt_eH4zL98zBx5u/goals');
  });

  it('navigates to the agent tasks page', () => {
    usePathnameMock.mockReturnValue('/agent/agt_eH4zL98zBx5u');

    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: 'tab.tasks' }));

    expect(switchTopicMock).toHaveBeenCalledWith(null, { skipRefreshMessage: true });
    expect(pushMock).toHaveBeenCalledWith('/agent/agt_eH4zL98zBx5u/tasks');
  });

  it.each(['/agent/agt_eH4zL98zBx5u/tasks', '/agent/agt_eH4zL98zBx5u/task/task_2FCHvjS7d4CA'])(
    'keeps the tasks entry active on %s',
    (pathname) => {
      usePathnameMock.mockReturnValue(pathname);

      render(<Nav />);

      expect(screen.getByRole('button', { name: 'tab.tasks' })).toHaveAttribute(
        'data-active',
        'true',
      );
    },
  );

  it('places topics above profile, goals, and tasks in the agent navigation', () => {
    usePathnameMock.mockReturnValue('/agent/agt_eH4zL98zBx5u');

    render(<Nav />);

    const labels = screen.getAllByRole('button').map((button) => button.textContent);
    expect(labels.indexOf('management.sidebarEntry')).toBeLessThan(labels.indexOf('tab.profile'));
    expect(labels.indexOf('tab.profile')).toBeLessThan(labels.indexOf('goalList.title'));
    expect(labels.indexOf('goalList.title')).toBeLessThan(labels.indexOf('tab.tasks'));
  });
});
