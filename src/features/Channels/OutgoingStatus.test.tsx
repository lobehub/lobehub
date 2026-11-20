/**
 * @vitest-environment happy-dom
 */
import { ChatErrorType } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ChannelOutgoingMessage } from '@/store/channel';

import { OutgoingStatus } from './OutgoingStatus';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@lobehub/ui', () => ({
  Button: ({ children }: { children?: unknown }) => createElement('button', {}, children as never),
  Icon: () => null,
}));
vi.mock('@/store/channel', () => ({ channelActions: { discardSend: vi.fn() } }));

const failed = (errorType?: string) =>
  ({ errorType, requestKey: 'key', status: 'failed' }) as ChannelOutgoingMessage;

describe('OutgoingStatus', () => {
  // A visitor over their share's message limit saw only "not sent", with no reason.
  it('explains a refusal the server named', () => {
    render(
      createElement(OutgoingStatus, {
        message: failed(ChatErrorType.ShareMessageLimitExceeded),
        onRetry: () => {},
      }),
    );
    expect(screen.getByRole('alert').textContent).toContain('receipt.errorShareMessageLimit');
    expect(screen.queryByText('outgoing.failed')).toBeNull();
  });

  it('stays generic for any other failure', () => {
    render(createElement(OutgoingStatus, { message: failed('offline'), onRetry: () => {} }));
    expect(screen.getByText('outgoing.failed')).toBeTruthy();
  });
});
