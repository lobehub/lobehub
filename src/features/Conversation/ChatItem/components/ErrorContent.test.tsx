/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ErrorContent from './ErrorContent';

const deleteMessageMock = vi.fn();
const updateMessageErrorMock = vi.fn();
let messageContent: string | undefined = '';
let isRegenerating = false;

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

  it('starts with collapsed diagnostics while keeping the reason and retry available', () => {
    const retry = vi.fn();
    const { container } = render(
      <ErrorContent
        error={{ message: 'Quota exhausted', extra: <pre>provider diagnostics</pre> }}
        id="msg-1"
        onRegenerate={retry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveAttribute('data-alert-variant', 'outlined');
    expect(screen.getByText('Quota exhausted')).toBeVisible();
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getByText('Show Details')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('clears only the error (keeps the message) when the turn already streamed content', () => {
    messageContent = 'already streamed text';
    render(<ErrorContent error={{ message: 'boom' } as any} id="msg-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Close alert' }));

    expect(updateMessageErrorMock).toHaveBeenCalledWith('msg-1', null);
    expect(deleteMessageMock).not.toHaveBeenCalled();
  });

  it('deletes the message when it is just an empty error', () => {
    messageContent = '';
    render(<ErrorContent error={{ message: 'boom' } as any} id="msg-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Close alert' }));

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
