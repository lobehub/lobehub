import { render, screen } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Sidebar from './Sidebar';
import type { GenerationLayoutCommonProps } from './types';

const mocks = vi.hoisted(() => ({
  activeWorkspaceId: null as null | string,
  updateSystemStatus: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Accordion: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  AccordionItem: ({
    action,
    children,
    title,
  }: {
    action?: ReactNode;
    children?: ReactNode;
    title?: ReactNode;
  }) => (
    <section>
      <header>
        {title}
        {action}
      </header>
      {children}
    </section>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Tabs: () => <div />,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock('@/features/NavPanel', () => ({
  NavPanelPortal: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/NavPanel/SideBarLayout', () => {
  const MockSideBarLayout = ({ body, header }: { body?: ReactNode; header?: ReactNode }) => {
    const [initialBody] = useState(body);

    return (
      <div>
        <div data-testid="sidebar-header">{header}</div>
        <div data-testid="sidebar-body">{initialBody}</div>
      </div>
    );
  };

  return { default: MockSideBarLayout };
});

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: any) =>
    selector({
      updateSystemStatus: mocks.updateSystemStatus,
    }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    imageTopicViewMode: () => 'list',
    videoTopicViewMode: () => 'list',
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: any) => selector({ isLogin: true }),
}));

vi.mock('@/store/user/slices/auth/selectors', () => ({
  authSelectors: {
    isLogin: (s: any) => s.isLogin,
  },
}));

vi.mock('./Body/List', () => ({
  default: ({ visibility }: { visibility?: 'private' | 'public' }) => (
    <div data-testid={`topic-list-${visibility ?? 'all'}`} />
  ),
}));

vi.mock('./Header', () => ({
  default: ({ namespace }: Pick<GenerationLayoutCommonProps, 'namespace'>) => (
    <div>{namespace} header</div>
  ),
}));

const createStore = (generationTopics: any[] = []) => {
  const storeState = {
    generationTopics,
    openNewGenerationTopic: vi.fn(),
    setNewGenerationTopicVisibility: vi.fn(),
    useFetchGenerationTopics: vi.fn(),
  };

  return (selector: any) => selector(storeState);
};

const createProps = (
  namespace: 'image' | 'video',
  generationTopics: any[] = [],
): GenerationLayoutCommonProps => ({
  breadcrumb: [{ href: `/${namespace}`, title: namespace }],
  generationTopicsSelector: (s: any) => s.generationTopics,
  namespace,
  navKey: 'image',
  useStore: createStore(generationTopics),
  viewModeStatusKey: namespace === 'image' ? 'imageTopicViewMode' : 'videoTopicViewMode',
});

describe('GenerationLayout Sidebar', () => {
  beforeEach(() => {
    mocks.activeWorkspaceId = null;
    mocks.updateSystemStatus.mockClear();
  });

  it('remounts sidebar content when switching generation namespaces under the shared nav key', () => {
    const { rerender } = render(<Sidebar {...createProps('video')} />);

    expect(screen.getByTestId('sidebar-body')).toHaveTextContent('topic.title');

    rerender(<Sidebar {...createProps('image')} />);

    expect(screen.getByTestId('sidebar-header')).toHaveTextContent('image header');
    expect(screen.getByTestId('sidebar-body')).toHaveTextContent('topic.title');
  });

  it('splits generation topics into private and workspace roots in workspace mode', () => {
    mocks.activeWorkspaceId = 'workspace-1';

    render(
      <Sidebar
        {...createProps('image', [
          { id: 'private-topic', title: 'Private', visibility: 'private' },
          { id: 'public-topic', title: 'Public', visibility: 'public' },
          { id: 'legacy-topic', title: 'Legacy' },
        ])}
      />,
    );

    expect(screen.getByText('topic.privateTitle 1')).toBeInTheDocument();
    expect(screen.getByText('topic.workspaceTitle 2')).toBeInTheDocument();
    expect(screen.getByTestId('topic-list-private')).toBeInTheDocument();
    expect(screen.getByTestId('topic-list-public')).toBeInTheDocument();
  });

  it('keeps a single generation topic root in personal mode', () => {
    render(
      <Sidebar
        {...createProps('image', [
          { id: 'private-topic', title: 'Private', visibility: 'private' },
          { id: 'public-topic', title: 'Public', visibility: 'public' },
        ])}
      />,
    );

    expect(screen.getByText('topic.title 2')).toBeInTheDocument();
    expect(screen.getByTestId('topic-list-all')).toBeInTheDocument();
    expect(screen.queryByText(/topic.privateTitle/)).not.toBeInTheDocument();
    expect(screen.queryByText(/topic.workspaceTitle/)).not.toBeInTheDocument();
  });
});
