/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ErrorContent from './ErrorContent';

const deleteMessageMock = vi.fn();
const updateMessageErrorMock = vi.fn();
let messageContent: string | undefined = '';
let isRegenerating = false;

// Drive the Alert's `afterClose` directly via a click, so we exercise
// ErrorContent's dismiss branching without the real close animation.
vi.mock('@lobehub/ui', () => ({
  Alert: ({ action, afterClose }: { action?: ReactNode; afterClose?: () => void }) => (
    <div>
      <button type="button" onClick={() => afterClose?.()}>
        close
      </button>
      {action}
    </div>
  ),
  Skeleton: { Button: () => <div>loading</div> },
}));

vi.mock('antd', () => ({
  Button: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/Conversation/store', () => ({
  dataSelectors: {
    getDisplayMessageById: (id: string) => () => ({ content: messageContent, id }),
  },
  messageStateSelectors: {
    isMessageRegenerating: () => () => isRegenerating,
  },
  useConversationStore: (selector: (s: unknown) => unknown) =>
    selector({
      deleteMessage: deleteMessageMock,
      updateMessageError: updateMessageErrorMock,
    }),
}));

describe('ErrorContent dismiss behavior', () => {
  beforeEach(() => {
    deleteMessageMock.mockClear();
    updateMessageErrorMock.mockClear();
    isRegenerating = false;
  });

  it('clears only the error (keeps the message) when the turn already streamed content', () => {
    messageContent = 'already streamed text';
    render(<ErrorContent error={{ message: 'boom' } as any} id="msg-1" />);

    fireEvent.click(screen.getByText('close'));

    expect(updateMessageErrorMock).toHaveBeenCalledWith('msg-1', null);
    expect(deleteMessageMock).not.toHaveBeenCalled();
  });

  it('deletes the message when it is just an empty error', () => {
    messageContent = '';
    render(<ErrorContent error={{ message: 'boom' } as any} id="msg-1" />);

    fireEvent.click(screen.getByText('close'));

    expect(deleteMessageMock).toHaveBeenCalledWith('msg-1');
    expect(updateMessageErrorMock).not.toHaveBeenCalled();
  });

  // Regression: `regenerate` sits outside AI_RUNTIME_OPERATION_TYPES, so nothing
  // else on the message reacts while a retry is in flight. Verified live: with a
  // regenerate op genuinely running, the message showed zero loading affordance
  // — the click read as "nothing happened" and invited a second one.
  it('puts the retry button in a pending state while this message is regenerating', () => {
    messageContent = '';
    isRegenerating = true;
    render(<ErrorContent error={{ message: 'boom' } as any} id="msg-1" onRegenerate={vi.fn()} />);

    const button = screen.getByRole('button', { name: /regenerate/i });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('leaves the retry button idle when nothing is regenerating', () => {
    messageContent = '';
    render(<ErrorContent error={{ message: 'boom' } as any} id="msg-1" onRegenerate={vi.fn()} />);

    const button = screen.getByRole('button', { name: /regenerate/i });

    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute('aria-busy');
  });
});
