import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'changelog': 'Changelog',
        'tab.more': 'More',
        'userPanel.docs': 'Docs',
        'userPanel.feedback': 'Feedback',
      })[key] || key,
  }),
}));

vi.mock('./style', () => ({
  RAIL_ICON_SIZE: 20,
  styles: { item: {}, itemActive: {} },
}));

interface MockItem {
  key: string;
  label?: ReactNode;
  type?: string;
}

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    DropdownMenu: ({ children, items }: { children: ReactNode; items: MockItem[] }) => (
      <div>
        {children}
        <ul data-testid={'menu'}>
          {items
            .filter((item) => item.type !== 'divider')
            .map((item) => (
              <li data-testid={`item-${item.key}`} key={item.key}>
                {item.label}
              </li>
            ))}
        </ul>
      </div>
    ),
  };
});

vi.mock('@/components/ChangelogModal', () => ({
  default: () => null,
  openChangelogModal: vi.fn(),
}));

vi.mock('@/components/FeedbackModal', () => ({
  default: () => null,
  openFeedbackModal: vi.fn(),
}));

vi.mock('@/business/client/hooks/useHelpMenuBugReportItem', () => ({
  useHelpMenuBugReportItem: () => null,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

const mockNavItems = {
  bottomMenuItems: [],
  topNavItems: [{ hidden: false, icon: 'icon', key: 'dashboard', title: 'Dashboard', url: '/dashboard' }],
};

vi.mock('@/hooks/useNavLayout', () => ({
  useNavLayout: () => mockNavItems,
}));

describe('NavRail MoreMenu', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps the footer Help entries reachable from the rail layout', async () => {
    const { default: MoreMenu } = await import('./MoreMenu');

    render(<MoreMenu />);

    // The rail replaces the sidebar footer, so docs / feedback / changelog must
    // stay in this menu instead of disappearing with the footer.
    expect(screen.getByTestId('item-docs')).toBeTruthy();
    expect(screen.getByTestId('item-feedback')).toBeTruthy();
    expect(screen.getByTestId('item-changelog')).toBeTruthy();

    // Routes without their own rail tab keep their entry.
    expect(screen.getByTestId('item-dashboard')).toBeTruthy();
  });
});
