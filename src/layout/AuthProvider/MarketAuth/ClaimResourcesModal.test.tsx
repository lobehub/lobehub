/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { HTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ClaimResourcesModal from './ClaimResourcesModal';

const messageErrorMock = vi.hoisted(() => vi.fn());
const messageSuccessMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) =>
      String(options?.defaultValue || key),
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  Modal: ({
    cancelText,
    children,
    okText,
    onCancel,
    onOk,
    open,
  }: {
    cancelText?: string;
    children: ReactNode;
    okText?: string;
    onCancel?: () => void;
    onOk?: () => void;
    open?: boolean;
  }) =>
    open ? (
      <div>
        <button onClick={onOk}>{okText || 'ok'}</button>
        <button onClick={onCancel}>{cancelText || 'cancel'}</button>
        {children}
      </div>
    ) : null,
  Text: ({ children, ...props }: HTMLAttributes<HTMLSpanElement>) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock('antd', () => {
  const ListItem = ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <div role="listitem" onClick={onClick}>
      {children}
    </div>
  );

  const List = ({
    dataSource,
    renderItem,
  }: {
    dataSource: any[];
    renderItem: (item: any) => ReactNode;
  }) => <div>{dataSource.map((item) => renderItem(item))}</div>;

  List.Item = ListItem;

  return {
    App: {
      useApp: () => ({
        message: {
          error: messageErrorMock,
          success: messageSuccessMock,
        },
      }),
    },
    Checkbox: ({ checked }: { checked?: boolean }) => (
      <input readOnly checked={checked} role="checkbox" type="checkbox" />
    ),
    List,
  };
});

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    market: {
      socialProfile: {
        claimResources: { mutate: vi.fn() },
      },
    },
  },
}));

describe('ClaimResourcesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reset selected resources when a new resource set is shown', async () => {
    const { rerender } = render(
      <ClaimResourcesModal
        open={true}
        resources={{
          plugins: [{ id: 1, identifier: 'plugin-a', type: 'plugin' }],
          skills: [{ id: 2, identifier: 'skill-a', type: 'skill' }],
        }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];

      expect(checkboxes[0].checked).toBe(true);
      expect(checkboxes[1].checked).toBe(true);
    });

    fireEvent.click(screen.getByText('plugin-a'));

    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];

      expect(checkboxes[0].checked).toBe(false);
      expect(checkboxes[1].checked).toBe(true);
    });

    rerender(
      <ClaimResourcesModal
        open={true}
        resources={{
          plugins: [{ id: 3, identifier: 'plugin-b', type: 'plugin' }],
          skills: [{ id: 4, identifier: 'skill-b', type: 'skill' }],
        }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];

      expect(screen.queryByText('plugin-a')).toBeNull();
      expect(screen.getByText('plugin-b')).toBeTruthy();
      expect(checkboxes[0].checked).toBe(true);
      expect(checkboxes[1].checked).toBe(true);
    });
  });
});
