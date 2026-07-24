/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MessageActionBar } from './index';

const permissionMock = vi.hoisted(() => ({
  canEdit: true,
}));

vi.mock('@lobehub/ui', () => ({
  ActionIconGroup: ({
    items,
    menu,
    style,
    variant,
  }: {
    items: { key?: string }[];
    menu?: { key?: string; type?: string }[];
    style?: React.CSSProperties;
    variant?: string;
  }) => (
    <div
      data-items={items.map((item) => item.key).join(',')}
      data-menu={menu?.map((item) => item.key || item.type).join(',') ?? ''}
      data-testid="action-group"
      data-variant={variant}
      style={style}
    />
  ),
  Block: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="action-container">{children}</div>
  ),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: permissionMock.canEdit, reason: '' }),
}));

vi.mock('./useBuildActions', () => ({
  useBuildActions: () => ({
    copy: { key: 'copy', label: 'Copy' },
    del: { key: 'del', label: 'Delete' },
    edit: { key: 'edit', label: 'Edit' },
    regenerate: { key: 'regenerate', label: 'Regenerate' },
  }),
}));

describe('MessageActionBar', () => {
  it('renders a leading control inside the shared action container', () => {
    permissionMock.canEdit = true;

    render(
      <MessageActionBar
        bar={['edit', 'copy']}
        leading={<button>Reaction</button>}
        ctx={{
          data: { content: 'hello', role: 'assistant' } as UIChatMessage,
          id: 'message-1',
          role: 'assistant',
        }}
      />,
    );

    const container = screen.getByTestId('action-container');
    expect(container).toContainElement(screen.getByRole('button', { name: 'Reaction' }));
    const actionGroup = screen.getByTestId('action-group');
    expect(actionGroup).toHaveAttribute('data-variant', 'borderless');
    expect(actionGroup).toHaveStyle({ background: 'transparent', borderRadius: '0' });
  });

  it('limits workspace viewers to copy only', () => {
    permissionMock.canEdit = false;

    render(
      <MessageActionBar
        bar={['edit', 'copy', 'regenerate']}
        menu={['edit', 'copy', 'del']}
        ctx={{
          data: { content: 'hello', role: 'assistant' } as UIChatMessage,
          id: 'message-1',
          role: 'assistant',
        }}
      />,
    );

    const group = screen.getByTestId('action-group');
    expect(group).toHaveAttribute('data-items', 'copy');
    expect(group).toHaveAttribute('data-menu', '');
  });
});
