/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import TaskListVisibilityFilter from './TaskListVisibilityFilter';

const taskStoreMock = vi.hoisted(() => ({
  setListVisibility: vi.fn(),
  visibility: 'workspace',
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
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
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => 'workspace-1',
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      listVisibility: taskStoreMock.visibility,
      setListVisibility: taskStoreMock.setListVisibility,
    }),
}));

describe('TaskListVisibilityFilter', () => {
  it('shows a trailing checkmark only for the active visibility option', () => {
    render(<TaskListVisibilityFilter />);

    expect(screen.getByTestId('extra-workspace')).toContainElement(
      screen.getByTestId('menu-extra-icon'),
    );
    expect(screen.getByTestId('extra-private')).toBeEmptyDOMElement();
    expect(screen.getByTestId('extra-all')).toBeEmptyDOMElement();
  });
});
