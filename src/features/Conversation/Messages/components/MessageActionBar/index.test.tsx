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
  }: {
    items: { key?: string }[];
    menu?: { key?: string; type?: string }[];
  }) => (
    <div
      data-items={items.map((item) => item.key).join(',')}
      data-menu={menu?.map((item) => item.key || item.type).join(',') ?? ''}
      data-testid="action-group"
    />
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
