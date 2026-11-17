// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { acceptRequest, notify, sendRequest } = vi.hoisted(() => ({
  acceptRequest: vi.fn(),
  notify: vi.fn(),
  sendRequest: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));
vi.mock('@/server/services/channel/featureGate', () => ({
  isChannelEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/database/models/contact', () => ({
  ContactModel: vi.fn(function () {
    return { acceptRequest, sendRequest };
  }),
}));
vi.mock('@/server/services/contact/notify', () => ({
  notifyContactRequestAfterResponse: notify,
}));

const { contactRouter } = await import('../contact');

const REQUEST_ID = '6f1c1d2e-4b0a-4c55-9a39-3b1d8f0e2a11';

describe('contactRouter notifications', () => {
  const caller = () => contactRouter.createCaller({ serverDB: {}, userId: 'me' } as any);

  beforeEach(() => vi.clearAllMocks());

  it('tells the addressee about a new request', async () => {
    sendRequest.mockResolvedValue({ requestId: REQUEST_ID, status: 'pending' });

    await expect(caller().sendRequest({ userId: 'them' })).resolves.toEqual({
      requestId: REQUEST_ID,
      status: 'pending',
    });
    expect(notify).toHaveBeenCalledWith({
      actorUserId: 'me',
      kind: 'received',
      recipientUserId: 'them',
      requestId: REQUEST_ID,
    });
  });

  it('tells them theirs was accepted when sending answers their pending request', async () => {
    sendRequest.mockResolvedValue({ requestId: REQUEST_ID, status: 'accepted' });

    await caller().sendRequest({ userId: 'them' });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'accepted', recipientUserId: 'them' }),
    );
  });

  it('tells the requester their request was accepted', async () => {
    acceptRequest.mockResolvedValue({ contactUserId: 'them' });

    await expect(caller().acceptRequest({ requestId: REQUEST_ID })).resolves.toEqual({
      contactUserId: 'them',
    });
    expect(notify).toHaveBeenCalledWith({
      actorUserId: 'me',
      kind: 'accepted',
      recipientUserId: 'them',
      requestId: REQUEST_ID,
    });
  });

  it('notifies no one when the request fails', async () => {
    sendRequest.mockRejectedValue(new Error('Already a contact'));

    await expect(caller().sendRequest({ userId: 'them' })).rejects.toThrow();
    expect(notify).not.toHaveBeenCalled();
  });
});
