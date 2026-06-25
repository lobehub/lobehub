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

// Drive the Alert's `afterClose` directly via a click, so we exercise
// ErrorContent's dismiss branching without the real close animation.
vi.mock('@lobehub/ui', () => ({
  Alert: ({ afterClose }: { afterClose?: () => void }) => (
    <button type="button" onClick={() => afterClose?.()}>
      close
    </button>
  ),
  Skeleton: { Button: () => <div>loading</div> },
}));

vi.mock('antd', () => ({
  Button: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/Conversation', () => ({
  useConversationStore: (selector: (s: unknown) => unknown) =>
    selector({
      deleteMessage: deleteMessageMock,
      updateMessageError: updateMessageErrorMock,
    }),
}));

vi.mock('@/features/Conversation/store', () => ({
  dataSelectors: {
    getDisplayMessageById: (id: string) => () => ({ content: messageContent, id }),
  },
}));

describe('ErrorContent dismiss behavior', () => {
  beforeEach(() => {
    deleteMessageMock.mockClear();
    updateMessageErrorMock.mockClear();
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
});
