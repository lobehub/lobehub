/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { CSSProperties, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ChatBody from './ChatBody';

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({
    children,
    flex,
    height,
    style,
    width,
    ...props
  }: {
    children?: ReactNode;
    flex?: number;
    height?: string;
    style?: CSSProperties;
    width?: string;
    [key: string]: unknown;
  }) => (
    <div
      data-flex={flex === undefined ? '' : String(flex)}
      data-height={height ?? ''}
      data-width={width ?? ''}
      style={style}
      {...props}
    >
      {children}
    </div>
  ),
}));

vi.mock('@/features/Conversation', () => ({
  ChatList: ({ welcome }: { welcome?: ReactNode }) => (
    <div data-testid="floating-chat-list">
      chat list
      {welcome}
    </div>
  ),
}));
vi.mock('@/features/AgentHome', () => ({
  default: () => <div data-testid="agent-welcome">agent welcome</div>,
}));

describe('FloatingChatPanel ChatBody', () => {
  it('renders ChatList with the agent welcome while InputRow owns the input', () => {
    render(<ChatBody />);

    const body = screen.getByTestId('floating-chat-panel-body');
    const list = screen.getByTestId('floating-chat-list');

    expect(body).toHaveAttribute('data-flex', '1');
    expect(body).toHaveAttribute('data-height', '100%');
    expect(body).toContainElement(list);
    expect(list).toContainElement(screen.getByTestId('agent-welcome'));
    expect(body).toHaveStyle({ overflow: 'hidden' });
    expect(screen.queryByTestId('floating-chat-input')).toBeNull();
  });
});
