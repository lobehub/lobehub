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
  ChatList: () => <div data-testid="floating-chat-list">chat list</div>,
}));

describe('FloatingChatPanel ChatBody', () => {
  it('renders only the ChatList — the input row is owned by InputRow now', () => {
    render(<ChatBody />);

    const body = screen.getByTestId('floating-chat-panel-body');
    const list = screen.getByTestId('floating-chat-list');

    expect(body).toHaveAttribute('data-flex', '1');
    expect(body).toHaveAttribute('data-height', '100%');
    expect(body).toContainElement(list);
    expect(body).toHaveStyle({ overflow: 'hidden' });
    expect(screen.queryByTestId('floating-chat-input')).toBeNull();
  });
});
