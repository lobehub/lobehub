/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ChatBody from './ChatBody';

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

    expect(body.style.getPropertyValue('--lobe-flex')).toBe('1');
    expect(body.style.getPropertyValue('--lobe-flex-height')).toBe('100%');
    expect(body).toContainElement(list);
    expect(list).toContainElement(screen.getByTestId('agent-welcome'));
    expect(body).toHaveStyle({ overflow: 'hidden' });
    expect(screen.queryByTestId('floating-chat-input')).toBeNull();
  });
});
