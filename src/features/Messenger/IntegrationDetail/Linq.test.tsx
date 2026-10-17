import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LinqLinkSetup } from './Linq';

const messengerServiceMocks = vi.hoisted(() => ({
  createLinqLink: vi.fn(),
  pollLinqLink: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const factories: ((original: typeof importOriginal) => unknown)[] = [
    async (importOriginal) => ({
      ...(await importOriginal<object>()),
      QRCode: ({ value }: { value: string }) => <span data-value={value} role="img" />,
    }),
    async (importOriginal) => ({
      ...((await importOriginal()) as Record<string, unknown>),
      createStaticStyles: () => ({ code: 'code', qrSlot: 'qrSlot', setup: 'setup', tips: 'tips' }),
    }),
  ];
  const merged: Record<string, unknown> = { ...actual };
  for (const factory of factories) {
    const part = (await factory(importOriginal)) as Record<string, unknown>;
    for (const [key, value] of Object.entries(part)) if (value !== actual[key]) merged[key] = value;
  }
  return merged;
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params?.time ? `${key}:${params.time}` : key,
  }),
}));

vi.mock('@/services/messenger', () => ({ messengerService: messengerServiceMocks }));
vi.mock('../i18n', () => ({ getMessengerErrorMessage: () => 'refresh failed' }));
vi.mock('./MessengerPush', () => ({ MessengerPushSection: () => null }));
vi.mock('./shared', () => ({
  DetailLayout: () => null,
  IntegrationDetailSkeleton: () => null,
  UserAgentConnection: () => null,
  useLinkActions: () => ({}),
  useMessengerData: () => ({ links: [] }),
}));

describe('LinqLinkSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    messengerServiceMocks.createLinqLink.mockResolvedValue({
      code: 'LH-QA8VN5BP',
      deepLink: {
        imessage: 'imessage:+15550100002?&body=LH-QA8VN5BP',
        number: '+15550100002',
        sms: 'sms:+15550100002?&body=LH-QA8VN5BP',
      },
      expiresAt: Date.now() + 10 * 60 * 1000,
      pollId: 'poll_1',
    });
  });

  it('points the primary action at the cross-platform sms: link and shows the server expiry', async () => {
    messengerServiceMocks.pollLinqLink.mockResolvedValue({ status: 'pending' });
    render(<LinqLinkSetup onLinked={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'messenger.linq.connectCta' }));

    const open = await screen.findByRole('link', { name: /messenger.linq.openMessages/ });
    expect(open).toHaveAttribute('href', 'sms:+15550100002?&body=LH-QA8VN5BP');
    expect(screen.getByText(/^messenger\.linq\.code\.expiresAt:/)).toBeInTheDocument();
  });

  it('retries only the refresh, never a new code, when refreshing after a link fails', async () => {
    messengerServiceMocks.pollLinqLink.mockResolvedValue({ status: 'linked' });
    const onLinked = vi
      .fn()
      .mockRejectedValueOnce(new Error('swr down'))
      .mockResolvedValue(undefined);
    render(<LinqLinkSetup onLinked={onLinked} />);
    fireEvent.click(screen.getByRole('button', { name: 'messenger.linq.connectCta' }));
    await screen.findByRole('link', { name: /messenger.linq.openMessages/ });
    await vi.advanceTimersByTimeAsync(2100);

    const refresh = await screen.findByRole('button', { name: /messenger.linq.refresh/ });
    expect(screen.queryByRole('button', { name: /messenger.linq.retry/ })).toBeNull();

    fireEvent.click(refresh);
    await waitFor(() => expect(onLinked).toHaveBeenCalledTimes(2));
    expect(messengerServiceMocks.createLinqLink).toHaveBeenCalledTimes(1);
  });
});
