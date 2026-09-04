import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type * as ReactModule from 'react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Body from './index';

interface MockGlobalState {
  status: {
    hiddenSidebarSections?: string[];
    sidebarExpandedKeys?: string[];
    sidebarItems?: string[];
  };
  updateSystemStatus: (patch: Partial<MockGlobalState['status']>) => void;
}

const mocks = vi.hoisted(() => ({
  globalState: undefined as unknown as MockGlobalState,
  navLayout: {
    bottomMenuItems: [] as { key: string; title: string; url: string }[],
    topNavItems: [] as { key: string; title: string; url: string }[],
  },
  activeTabKey: 'home',
  activeTabListeners: new Set<() => void>(),
  accordionCommits: vi.fn(),
  setActiveTabKey: (key: string) => {
    mocks.activeTabKey = key;
    for (const listener of mocks.activeTabListeners) listener();
  },
  updateSystemStatus: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Accordion: ({
    children,
    expandedKeys,
    onExpandedChange,
  }: {
    children: React.ReactNode;
    expandedKeys?: string[];
    onExpandedChange?: (keys: string[]) => void;
  }) => (
    <div data-expanded-keys={JSON.stringify(expandedKeys)} data-testid="sidebar-accordion">
      <button aria-label="collapse recents" onClick={() => onExpandedChange?.(['agent'])} />
      {children}
    </div>
  ),
  Flexbox: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar-body">{children}</div>
  ),
}));

vi.mock('react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));

vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ active, title }: { active?: boolean; title: string }) => (
    <div data-active={active}>{title}</div>
  ),
}));

vi.mock('@/hooks/useIsActiveTab', async () => {
  const { useSyncExternalStore } = await vi.importActual<typeof ReactModule>('react');

  return {
    useIsActiveTab: (key: string) =>
      useSyncExternalStore(
        (listener) => {
          mocks.activeTabListeners.add(listener);
          return () => mocks.activeTabListeners.delete(listener);
        },
        () => mocks.activeTabKey === key,
      ),
  };
});

vi.mock('@/hooks/useNavLayout', () => ({
  useNavLayout: () => mocks.navLayout,
}));

vi.mock('@/utils/navigation', () => ({
  isModifierClick: () => false,
}));

vi.mock('@/features/Home/Recents', () => ({
  default: ({ itemKey }: { itemKey: string }) => (
    <Profiler id={itemKey} onRender={mocks.accordionCommits}>
      <div data-testid={`sidebar-item-${itemKey}`} />
    </Profiler>
  ),
}));

vi.mock('./Agent', () => ({
  default: ({ itemKey }: { itemKey: string }) => <div data-testid={`sidebar-item-${itemKey}`} />,
}));

vi.mock('./Private', () => ({
  default: ({ itemKey }: { itemKey: string }) => <div data-testid={`sidebar-item-${itemKey}`} />,
}));

vi.mock('./CustomizeSidebarModal', () => ({
  openCustomizeSidebarModal: vi.fn(),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: MockGlobalState) => unknown) => selector(mocks.globalState),
}));

beforeEach(() => {
  mocks.activeTabKey = 'home';
  mocks.accordionCommits.mockReset();
  mocks.updateSystemStatus.mockReset();
  mocks.navLayout = {
    bottomMenuItems: [],
    topNavItems: [],
  };
  mocks.globalState = {
    status: {
      hiddenSidebarSections: [],
      sidebarExpandedKeys: ['recents', 'agent'],
      sidebarItems: ['recents', 'agent'],
    },
    updateSystemStatus: mocks.updateSystemStatus,
  };
});

afterEach(() => {
  cleanup();
});

describe('Home sidebar body', () => {
  it('uses persisted sidebar accordion expanded keys', () => {
    mocks.globalState.status.sidebarExpandedKeys = ['agent'];

    render(<Body />);

    expect(screen.getByTestId('sidebar-accordion')).toHaveAttribute(
      'data-expanded-keys',
      '["agent"]',
    );
  });

  it('persists sidebar accordion expanded changes', () => {
    render(<Body />);

    fireEvent.click(screen.getByRole('button', { name: 'collapse recents' }));

    expect(mocks.updateSystemStatus).toHaveBeenCalledWith({ sidebarExpandedKeys: ['agent'] });
  });

  it('renders items strictly in sidebarItems order with the spacer at its stored position', () => {
    mocks.navLayout = {
      bottomMenuItems: [
        { key: 'image', title: 'Image', url: '/image' },
        { key: 'resource', title: 'Resource', url: '/resource' },
      ],
      topNavItems: [
        { key: 'pages', title: 'Pages', url: '/page' },
        { key: 'tasks', title: 'Tasks', url: '/tasks' },
      ],
    };
    mocks.globalState.status.sidebarItems = [
      'pages',
      'recents',
      'agent',
      '__spacer__',
      'image',
      'tasks',
      'resource',
    ];

    render(<Body />);

    const children = Array.from(screen.getByTestId('sidebar-body').children);
    const spacerIndex = children.findIndex((child) =>
      child.hasAttribute('data-sidebar-bottom-spacer'),
    );

    expect(spacerIndex).toBe(2);
    expect(children[0]).toHaveTextContent('Pages');
    expect(children[1]).toHaveAttribute('data-testid', 'sidebar-accordion');
    expect(children[3]).toHaveTextContent('Image');
    expect(children[4]).toHaveTextContent('Tasks');
    expect(children[5]).toHaveTextContent('Resource');
  });

  it('keeps a top item that was dragged past the spacer in its new position', () => {
    mocks.navLayout = {
      bottomMenuItems: [{ key: 'image', title: 'Image', url: '/image' }],
      topNavItems: [{ key: 'tasks', title: 'Tasks', url: '/tasks' }],
    };
    // User dragged `tasks` from the top section to sit after `image`.
    mocks.globalState.status.sidebarItems = ['recents', 'agent', '__spacer__', 'image', 'tasks'];

    render(<Body />);

    const children = Array.from(screen.getByTestId('sidebar-body').children);

    expect(children[0]).toHaveAttribute('data-testid', 'sidebar-accordion');
    expect(children[1]).toHaveAttribute('data-sidebar-bottom-spacer');
    expect(children[2]).toHaveTextContent('Image');
    expect(children[3]).toHaveTextContent('Tasks');
  });

  it('updates the active nav link without rerendering accordion content', () => {
    mocks.navLayout.topNavItems = [{ key: 'tasks', title: 'Tasks', url: '/tasks' }];
    mocks.globalState.status.sidebarItems = ['recents', 'tasks'];

    render(<Body />);

    expect(screen.getByText('Tasks')).toHaveAttribute('data-active', 'false');
    mocks.accordionCommits.mockClear();

    act(() => mocks.setActiveTabKey('tasks'));

    expect(screen.getByText('Tasks')).toHaveAttribute('data-active', 'true');
    expect(mocks.accordionCommits).not.toHaveBeenCalled();
  });
});
