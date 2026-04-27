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

vi.mock('@/routes/(main)/agent/features/Conversation/MainChatInput', () => ({
  default: () => <div data-testid="floating-chat-input">chat input</div>,
}));

describe('FloatingChatPanel ChatBody', () => {
  it('keeps the chat input after the list while leaving scroll ownership to the virtual list', () => {
    render(<ChatBody />);

    const body = screen.getByTestId('floating-chat-panel-body');
    const list = screen.getByTestId('floating-chat-panel-list');
    const input = screen.getByTestId('floating-chat-input');

    expect(body).toHaveAttribute('data-flex', '1');
    expect(body).toHaveAttribute('data-height', '100%');
    expect(list).toHaveAttribute('data-flex', '1');
    expect(body).toContainElement(list);
    expect(body).toContainElement(input);
    expect(body).toHaveStyle({ overflow: 'hidden' });
    expect(list).toHaveStyle({ overflow: 'hidden' });
    expect(list.compareDocumentPosition(input)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
