/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import TaskVisibilityTag from './TaskVisibilityTag';

vi.mock('@lobehub/ui', () => ({
  DropdownMenu: ({
    children,
    items,
  }: {
    children: ReactNode;
    items: Array<{ extra?: ReactNode; key: string }>;
  }) => (
    <>
      {children}
      {items.map((item) => (
        <div data-testid={`extra-${item.key}`} key={item.key}>
          {item.extra}
        </div>
      ))}
    </>
  ),
  Icon: () => <span data-testid="menu-extra-icon" />,
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ trigger: 'trigger', triggerDisabled: 'trigger-disabled' }),
  cssVar: {
    colorTextDescription: '#999',
    colorTextSecondary: '#666',
  },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => 'workspace-1',
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true, reason: '' }),
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ updateTaskVisibility: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue,
  }),
}));

describe('TaskVisibilityTag', () => {
  it('shows only the current checkmark without unsupported numeric shortcut hints', () => {
    render(
      <TaskVisibilityTag visibility="private">
        <span>Visibility</span>
      </TaskVisibilityTag>,
    );

    expect(screen.getByTestId('extra-private')).toContainElement(
      screen.getByTestId('menu-extra-icon'),
    );
    expect(screen.getByTestId('extra-public')).toBeEmptyDOMElement();
    expect(screen.queryByText('1')).not.toBeInTheDocument();
    expect(screen.queryByText('2')).not.toBeInTheDocument();
  });
});
