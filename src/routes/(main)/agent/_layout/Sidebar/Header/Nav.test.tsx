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

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock('@lobehub/ui/icons', () => ({
  BotPromptIcon: () => null,
}));

vi.mock('lucide-react', () => ({
  MessageSquarePlusIcon: () => null,
  RadioTowerIcon: () => null,
  SearchIcon: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router-dom', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await vi.importActual('react-router-dom')) as typeof import('react-router-dom');

  return {
    ...actual,
    useParams: useParamsMock,
  };
});

vi.mock('@/const/url', () => ({
  SESSION_CHAT_URL: (agentId: string) => `/agent/${agentId}`,
}));

vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({
    active,
    onClick,
    title,
  }: {
    active?: boolean;
    onClick?: () => void;
    title: ReactNode;
  }) => (
    <button data-active={String(active)} type="button" onClick={onClick}>
      {title}
    </button>
  ),
}));

vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: () => ({
    push: pushMock,
  }),
}));

vi.mock('@/libs/router/navigation', () => ({
  usePathname: usePathnameMock,
}));

vi.mock('@/libs/swr', () => ({
  useActionSWR: () => ({
    mutate: mutateMock,
  }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    isCurrentAgentHeterogeneous: () => false,
  },
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

describe('Agent sidebar header nav', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    openNewTopicOrSaveTopicMock.mockReset();
    pushMock.mockReset();
    switchTopicMock.mockReset();
    toggleCommandMenuMock.mockReset();
    useParamsMock.mockReset();
    usePathnameMock.mockReset();

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
});
