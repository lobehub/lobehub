import { describe, expect, it } from 'vitest';

import {
  buildEmbedPath,
  EMBED_MESSAGE_SOURCE,
  readEmbedMessage,
  readHostMessage,
  wrapEmbedMessage,
} from './protocol';

describe('embed protocol', () => {
  it('round-trips host messages through the envelope', () => {
    expect(readHostMessage(wrapEmbedMessage({ theme: 'dark', type: 'init' }))).toEqual({
      theme: 'dark',
      type: 'init',
    });
    expect(readHostMessage(wrapEmbedMessage({ theme: 'light', type: 'setTheme' }))).toEqual({
      theme: 'light',
      type: 'setTheme',
    });
  });

  it('ignores foreign traffic and malformed payloads', () => {
    expect(readHostMessage({ theme: 'dark', type: 'init' })).toBeNull();
    expect(readHostMessage('init')).toBeNull();
    expect(
      readHostMessage({ source: EMBED_MESSAGE_SOURCE, theme: 'neon', type: 'setTheme' }),
    ).toBeNull();
    expect(readHostMessage({ source: EMBED_MESSAGE_SOURCE, type: 'close' })).toBeNull();
    expect(readEmbedMessage({ source: 'other', type: 'ready' })).toBeNull();
    expect(readEmbedMessage({ source: EMBED_MESSAGE_SOURCE, type: 'topicCreated' })).toBeNull();
  });

  it('keeps only the documented fields of embed messages', () => {
    expect(
      readEmbedMessage({ ...wrapEmbedMessage({ type: 'messageSent' }), content: 'secret' }),
    ).toEqual({ type: 'messageSent' });
    expect(readEmbedMessage(wrapEmbedMessage({ topicId: 'tpc_1', type: 'topicCreated' }))).toEqual({
      topicId: 'tpc_1',
      type: 'topicCreated',
    });
  });

  it('encodes the slug into the embed path', () => {
    expect(buildEmbedPath('my-bot')).toBe('/embed/agent/my-bot');
    expect(buildEmbedPath('a/b')).toBe('/embed/agent/a%2Fb');
  });
});
