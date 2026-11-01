import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createChannelSendRequest } from './sendRequest';

const scope = 'personal:user:channel:thread-draft';
const payload = { content: '@Agent first reply', fileIds: ['file-a'], mentions: ['member-a'] };

describe('Channel ambiguous send identity', () => {
  beforeEach(() => sessionStorage.clear());

  it('preserves an ordinary send retry started before quote replies were supported', () => {
    const key = crypto.randomUUID();
    sessionStorage.setItem(
      'lobehub:channel-send-requests:v1',
      JSON.stringify([
        {
          fingerprint: JSON.stringify([payload.content, payload.mentions, payload.fileIds]),
          key,
          scope,
        },
      ]),
    );

    expect(createChannelSendRequest().get(scope, payload)).toBe(key);
  });

  it('reuses the request after an ambiguous failure, including composer remount and reload', () => {
    const first = createChannelSendRequest();
    const key = first.get(scope, payload);
    expect(first.get(scope, { ...payload })).toBe(key);
    // A fresh instance has no React/editor memory; it reads the persisted send attempt.
    expect(createChannelSendRequest().get(scope, payload)).toBe(key);
  });

  it('changes identity for edited content, recipients or attachments, but not recipient order', () => {
    const request = createChannelSendRequest();
    const key = request.get(scope, { ...payload, mentions: ['a', 'b'] });
    expect(request.get(scope, { ...payload, mentions: ['b', 'a'] })).toBe(key);
    const edited = request.get(scope, { ...payload, content: 'different' });
    expect(edited).not.toBe(key);
    const recipient = request.get(scope, { ...payload, content: 'different', mentions: ['b'] });
    expect(recipient).not.toBe(edited);
    expect(request.get(scope, { ...payload, fileIds: ['file-b'] })).not.toBe(recipient);
  });

  it('gives a different quote its own retry identity and restores an unchanged quote after reload', () => {
    const request = createChannelSendRequest();
    const first = request.get(scope, { ...payload, replyToId: 'first' });
    expect(createChannelSendRequest().get(scope, { ...payload, replyToId: 'first' })).toBe(first);
    expect(request.get(scope, { ...payload, replyToId: 'second' })).not.toBe(first);
    expect(request.get(scope, payload)).not.toBe(first);
  });

  it('lets a successful message be intentionally sent again and isolates conversations and identities', () => {
    const request = createChannelSendRequest();
    const key = request.get(scope, payload);
    expect(request.get('other-user:channel:thread-draft', payload)).not.toBe(key);
    expect(request.get('personal:user:channel:main', payload)).not.toBe(key);
    request.complete(key);
    expect(createChannelSendRequest().get(scope, payload)).not.toBe(key);
  });

  it('does not clear a newer edited attempt when an older request completes', () => {
    const request = createChannelSendRequest();
    const old = request.get(scope, payload);
    const newer = request.get(scope, { ...payload, content: 'edited while awaiting a result' });
    request.complete(old);
    expect(
      createChannelSendRequest().get(scope, {
        ...payload,
        content: 'edited while awaiting a result',
      }),
    ).toBe(newer);
  });

  it('continues to send and retry when browser storage is unavailable', () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    try {
      const request = createChannelSendRequest();
      const key = request.get(scope, payload);
      expect(request.get(scope, payload)).toBe(key);
    } finally {
      storage.mockRestore();
    }
  });
});
