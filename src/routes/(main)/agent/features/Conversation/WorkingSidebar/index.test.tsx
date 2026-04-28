import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as swr from '@/libs/swr';
import { useGlobalStore } from '@/store/global';
import { initialState } from '@/store/global/initialState';
import { useUserStore } from '@/store/user';
import { initialState as initialUserState } from '@/store/user/initialState';

import AgentWorkingSidebar from './index';

vi.mock('@/libs/swr', async (importOriginal) => {
  const actual = await importOriginal<typeof swr>();
  return { ...actual, useClientDataSWR: vi.fn() };
});

vi.mock('@lobehub/ui', () => ({
  Accordion: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  ActionIcon: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <button {...props}>{children}</button>
  ),
  AccordionItem: ({
    children,
    title,
    ...props
  }: {
    children?: ReactNode;
    title?: ReactNode;
    [key: string]: unknown;
  }) => (
    <div {...props}>
      {title}
      {children}
    </div>
  ),
  Button: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <button {...props}>{children}</button>
  ),
  Center: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Checkbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  DraggablePanel: ({
    children,
    expand,
    stableLayout,
  }: {
    children?: ReactNode;
    expand?: boolean;
    stableLayout?: boolean;
  }) => (
    <div
      data-expand={String(expand)}
      data-stable-layout={String(Boolean(stableLayout))}
      data-testid="right-panel"
    >
      {children}
    </div>
  ),
  Empty: ({ description }: { description?: ReactNode }) => <div>{description}</div>,
  Avatar: ({ avatar }: { avatar?: ReactNode | string }) => <div>{avatar}</div>,
  Flexbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Icon: () => <div />,
  Markdown: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Progress: () => <div data-testid="workspace-progress-bar" />,
  ShikiLobeTheme: {},
  Skeleton: { Button: () => <div /> },
  Tag: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TextArea: () => <textarea />,
  TooltipGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: { error: vi.fn(), success: vi.fn() },
      modal: { confirm: vi.fn() },
    }),
  },
  Progress: () => <div data-testid="workspace-progress-bar" />,
  Spin: () => <div data-testid="spin" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'workingPanel.resources': 'Resources',
          'workingPanel.resources.empty': 'No agent documents yet',
        }) as Record<string, string>
      )[key] || key,
  }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector?.({
      activeAgentId: 'agent-1',
    }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      activeTopicId: undefined,
      closeDocument: vi.fn(),
      dbMessagesMap: {},
      openDocument: vi.fn(),
      portalStack: [],
    }),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: {
    portalDocumentId: () => null,
  },
}));

beforeEach(() => {
  vi.mocked(swr.useClientDataSWR).mockImplementation((() => ({
    data: [],
    error: undefined,
    isLoading: false,
  })) as unknown as typeof swr.useClientDataSWR);
  useGlobalStore.setState({
    ...initialState,
    isStatusInit: true,
    status: { ...initialState.status },
  });
  useUserStore.setState({
    ...initialUserState,
    preference: {
      ...initialUserState.preference,
      lab: { ...initialUserState.preference.lab },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AgentWorkingSidebar', () => {
  it('renders panel header title and resources empty state', () => {
    render(<AgentWorkingSidebar />);

    // Panel-level title
    expect(screen.getAllByText('Resources').length).toBeGreaterThan(0);

    const resources = screen.getByTestId('workspace-resources');
    expect(resources).toHaveTextContent('No agent documents yet');
  });

  it('mounts a right panel wrapper', () => {
    render(<AgentWorkingSidebar />);

    expect(screen.getByTestId('right-panel')).toBeInTheDocument();
    expect(screen.getByTestId('right-panel')).toHaveAttribute('data-stable-layout', 'true');
  });
});
