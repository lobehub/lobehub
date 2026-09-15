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
const actionMocks = vi.hoisted(() => ({
  commentsAvailable: true,
  onCopyMessageId: vi.fn(),
}));
/** Last `menu` prop handed to ActionIconGroup, so submenu wiring is assertable. */
const rendered = vi.hoisted(() => ({ menu: undefined as any }));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
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
    (rendered.menu = menu),
    (
      <div
        data-has-menu={String(!!menu)}
        data-items={items.map((item) => item.key).join(',')}
        data-menu={menu?.map((item) => item.key || item.type).join(',') ?? ''}
        data-testid="action-group"
        data-variant={variant}
        style={style}
      />
    )
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
    advanced: { key: 'advanced', label: 'Advanced' },
    comments: actionMocks.commentsAvailable
      ? {
          key: 'comments',
          label: 'Comments',
        }
      : null,
    copy: { key: 'copy', label: 'Copy' },
    copyMessageId: {
      handleClick: actionMocks.onCopyMessageId,
      key: 'copyMessageId',
      label: 'Copy Message ID',
    },
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

  it('keeps read-only comments available to workspace viewers', () => {
    actionMocks.commentsAvailable = true;
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
    expect(group).toHaveAttribute('data-items', 'copy,comments');
    expect(group).toHaveAttribute('data-menu', '');
  });

  it('promotes the zero-comment entry from the menu to the action bar', () => {
    actionMocks.commentsAvailable = true;
    permissionMock.canEdit = true;

    render(
      <MessageActionBar
        bar={['copy']}
        menu={['comments']}
        ctx={{
          data: { content: 'hello', role: 'assistant' } as UIChatMessage,
          id: 'message-1',
          role: 'assistant',
        }}
      />,
    );

    const group = screen.getByTestId('action-group');
    expect(group).toHaveAttribute('data-items', 'copy,comments');
    expect(group).toHaveAttribute('data-menu', '');
  });

  it('keeps the direct action absent when the message already has comments', () => {
    actionMocks.commentsAvailable = false;
    permissionMock.canEdit = true;

    render(
      <MessageActionBar
        bar={['copy']}
        menu={['comments']}
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

  it('collapses a menu whose every action opted out instead of passing []', () => {
    actionMocks.commentsAvailable = true;
    permissionMock.canEdit = true;

    // 'tts' is not in the mocked registry — the slot resolves to nothing, like
    // copyOperationId with dev mode off. ActionIconGroup would render an empty
    // overflow trigger for [], so the bar must pass undefined instead.
    render(
      <MessageActionBar
        bar={['copy']}
        menu={['tts']}
        ctx={{
          data: { content: 'hello', role: 'assistant' } as UIChatMessage,
          id: 'message-1',
          role: 'assistant',
        }}
      />,
    );

    expect(screen.getByTestId('action-group')).toHaveAttribute('data-has-menu', 'false');
  });

  it('drops dangling dividers when the group behind one opted out', () => {
    actionMocks.commentsAvailable = true;
    permissionMock.canEdit = true;

    // 'tts' resolves to nothing (not in the mocked registry), so the trailing
    // "divider + hidden group" must collapse away, and the double boundary
    // around the missing middle group must merge into one divider.
    render(
      <MessageActionBar
        bar={['copy']}
        menu={['edit', 'divider', 'tts', 'divider', 'del', 'divider', 'restoreToInput']}
        ctx={{
          data: { content: 'hello', role: 'assistant' } as UIChatMessage,
          id: 'message-1',
          role: 'assistant',
        }}
      />,
    );

    expect(screen.getByTestId('action-group')).toHaveAttribute('data-menu', 'edit,divider,del');
  });

  // The menu never invokes an item that has no `onClick` of its own, and
  // ActionIconGroup only attaches one to top-level items. Without this wiring a
  // submenu entry closes the menu and silently does nothing.
  it('lets a submenu child dispatch itself', () => {
    permissionMock.canEdit = true;
    actionMocks.onCopyMessageId.mockClear();

    render(
      <MessageActionBar
        bar={['copy']}
        menu={[{ children: ['copyMessageId'], key: 'advanced' }]}
        ctx={{
          data: { content: 'hello', role: 'assistant' } as UIChatMessage,
          id: 'message-1',
          role: 'assistant',
        }}
      />,
    );

    const child = rendered.menu?.[0]?.children?.[0];
    expect(child.key).toBe('copyMessageId');
    child.onClick();
    expect(actionMocks.onCopyMessageId).toHaveBeenCalledTimes(1);
  });
});
