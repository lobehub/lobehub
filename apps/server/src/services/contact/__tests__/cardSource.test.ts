// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveCardRequestSource } from '../cardSource';

const { findAccess, findContactCardMessage } = vi.hoisted(() => ({
  findAccess: vi.fn(),
  findContactCardMessage: vi.fn(),
}));
vi.mock('@/database/repositories/channel', () => ({
  ChannelRepository: class {
    findAccess = findAccess;
  },
}));
vi.mock('@/database/repositories/channel/contactCard', () => ({ findContactCardMessage }));

const params = {
  addresseeId: 'max',
  channelId: 'chn_aaaaaaaaaaaa',
  db: {} as never,
  messageId: 'message',
  userId: 'me',
};
const maxCard = { type: 'user', user: { id: 'max' } };

describe('resolveCardRequestSource', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    findAccess.mockResolvedValue({ channel: {}, member: {} });
  });

  it('records the card’s sender as who recommended the addressee', async () => {
    findContactCardMessage.mockResolvedValue({ card: maxCard, senderId: 'carol' });
    await expect(resolveCardRequestSource(params)).resolves.toEqual({
      channelId: params.channelId,
      messageId: 'message',
      sharedById: 'carol',
      type: 'card',
    });
  });

  it('refuses a Channel the requester cannot read', async () => {
    findAccess.mockResolvedValue(undefined);
    findContactCardMessage.mockResolvedValue({ card: maxCard, senderId: 'carol' });
    await expect(resolveCardRequestSource(params)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(findContactCardMessage).not.toHaveBeenCalled();
  });

  it('refuses a card that introduces someone else, or no card at all', async () => {
    findContactCardMessage.mockResolvedValueOnce({
      card: { type: 'user', user: { id: 'other' } },
      senderId: 'carol',
    });
    await expect(resolveCardRequestSource(params)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    findContactCardMessage.mockResolvedValueOnce(undefined);
    await expect(resolveCardRequestSource(params)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
