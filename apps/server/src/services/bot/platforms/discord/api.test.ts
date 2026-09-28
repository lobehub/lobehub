// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { DiscordApi } from './api';

const makeApi = () => {
  const api = new DiscordApi('token');
  const get = vi.fn();
  const post = vi.fn().mockResolvedValue({ id: 'msg-1' });
  (api as any).rest = { get, post };
  return { api, get, post };
};

describe('DiscordApi.createMessage', () => {
  it('posts a plain JSON body when neither files nor embeds are given', async () => {
    const { api, post } = makeApi();

    const result = await api.createMessage('ch-1', 'hello');

    expect(post).toHaveBeenCalledWith('/channels/ch-1/messages', { body: { content: 'hello' } });
    expect(result).toEqual({ id: 'msg-1' });
  });

  it('includes embeds in the body', async () => {
    const { api, post } = makeApi();
    const embeds = [{ color: 0x58_65_f2, title: 'Card' }];

    await api.createMessage('ch-1', 'hello', undefined, embeds);

    expect(post).toHaveBeenCalledWith('/channels/ch-1/messages', {
      body: { content: 'hello', embeds },
    });
  });

  it('sends embeds alongside files in the same message', async () => {
    const { api, post } = makeApi();
    const files = [{ data: Buffer.from('x'), name: 'x.png' }];
    const embeds = [{ title: 'Card' }];

    await api.createMessage('ch-1', 'hello', files, embeds);

    expect(post).toHaveBeenCalledWith('/channels/ch-1/messages', {
      body: { content: 'hello', embeds },
      files,
    });
  });

  it('omits the embeds key for an empty array', async () => {
    const { api, post } = makeApi();

    await api.createMessage('ch-1', 'hello', undefined, []);

    expect(post).toHaveBeenCalledWith('/channels/ch-1/messages', { body: { content: 'hello' } });
  });
});

describe('DiscordApi.listThreadMembers', () => {
  it('requests expanded member data for up to 100 thread members', async () => {
    const { api, get } = makeApi();
    get.mockResolvedValue([{ user_id: 'alice' }]);

    await expect(api.listThreadMembers('thread-1')).resolves.toEqual([{ user_id: 'alice' }]);

    expect(get).toHaveBeenCalledWith('/channels/thread-1/thread-members', {
      query: new URLSearchParams({ limit: '100', with_member: 'true' }),
    });
  });
});
