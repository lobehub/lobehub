// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const model = vi.hoisted(() => ({
  acceptRequest: vi.fn(),
  cancelRequest: vi.fn(),
  declineRequest: vi.fn(),
  openTo: vi.fn(),
  removeExternal: vi.fn(),
  removeUser: vi.fn(),
  sendRequest: vi.fn(),
}));
const { acceptRequest, sendRequest } = model;
const { contactsChanged, notify, openConversation } = vi.hoisted(() => ({
  contactsChanged: vi.fn(),
  notify: vi.fn(),
  openConversation: vi.fn(),
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
    return model;
  }),
}));
vi.mock('@/server/services/contact/notify', () => ({
  notifyContactRequestAfterResponse: notify,
  notifyContactsChangedAfterResponse: contactsChanged,
}));

vi.mock('@/server/services/contact/conversation', () => ({
  openContactConversation: openConversation,
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

  describe('opens the conversation of the new contacts', () => {
    it('as the requester, in the request scope, on accepting', async () => {
      acceptRequest.mockResolvedValue({ contactUserId: 'them', workspaceId: 'ws' });
      await caller().acceptRequest({ requestId: REQUEST_ID });
      expect(openConversation).toHaveBeenCalledWith({
        addresseeId: 'me',
        db: {},
        requesterId: 'them',
        workspaceId: 'ws',
      });
    });

    it('when sending answers their pending request', async () => {
      sendRequest.mockResolvedValue({ requestId: REQUEST_ID, status: 'accepted' });
      await caller().sendRequest({ userId: 'them' });
      expect(openConversation).toHaveBeenCalledWith({
        addresseeId: 'me',
        db: {},
        requesterId: 'them',
        workspaceId: null,
      });
    });

    it('not for a request still pending', async () => {
      sendRequest.mockResolvedValue({ requestId: REQUEST_ID, status: 'pending' });
      await caller().sendRequest({ userId: 'them' });
      expect(openConversation).not.toHaveBeenCalled();
    });
  });

  it('notifies no one when the request fails', async () => {
    sendRequest.mockRejectedValue(new Error('Already a contact'));

    await expect(caller().sendRequest({ userId: 'them' })).rejects.toThrow();
    expect(notify).not.toHaveBeenCalled();
  });

  describe('refreshes the address book of both people', () => {
    it('on a new request', async () => {
      sendRequest.mockResolvedValue({ requestId: REQUEST_ID, status: 'pending' });
      await caller().sendRequest({ userId: 'them' });
      expect(contactsChanged).toHaveBeenCalledWith(['me', 'them']);
    });

    it('on accepting', async () => {
      acceptRequest.mockResolvedValue({ contactUserId: 'them' });
      await caller().acceptRequest({ requestId: REQUEST_ID });
      expect(contactsChanged).toHaveBeenCalledWith(['me', 'them']);
    });

    it('on declining, telling the requester', async () => {
      model.declineRequest.mockResolvedValue({ requesterId: 'them' });
      await caller().declineRequest({ requestId: REQUEST_ID });
      expect(contactsChanged).toHaveBeenCalledWith(['me', 'them']);
    });

    it('on withdrawing, telling the addressee', async () => {
      model.cancelRequest.mockResolvedValue({ addresseeId: 'them' });
      await caller().cancelRequest({ requestId: REQUEST_ID });
      expect(contactsChanged).toHaveBeenCalledWith(['me', 'them']);
    });

    it('on removing a contact', async () => {
      await caller().removeUser({ userId: 'them' });
      expect(contactsChanged).toHaveBeenCalledWith(['me', 'them']);
    });

    it('not when the change fails', async () => {
      model.declineRequest.mockRejectedValue(new Error('Request not found'));
      await expect(caller().declineRequest({ requestId: REQUEST_ID })).rejects.toThrow();
      expect(contactsChanged).not.toHaveBeenCalled();
    });
  });
});
