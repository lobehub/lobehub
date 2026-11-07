import { AgentRuntimeErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { findUnreachableMediaUrl, redactMediaUrl, stripUnreachableMedia } from './unreachableMedia';

const DEAD = 'https://app.lobehub.com/f/file_1';
const ALIVE = 'https://app.lobehub.com/f/file_10';

const history = [
  { content: 'hi', role: 'user' },
  {
    content: [
      { text: 'look', type: 'text' },
      { image_url: { url: DEAD }, type: 'image_url' },
      { image_url: { url: ALIVE }, type: 'image_url' },
    ],
    role: 'user',
  },
];

describe('findUnreachableMediaUrl', () => {
  it('finds the link named by a provider download failure', () => {
    const error = {
      error: { message: `Error while downloading ${DEAD}.` },
      errorType: AgentRuntimeErrorType.RemoteMediaDownloadFailed,
    };

    expect(findUnreachableMediaUrl(error, history)).toBe(DEAD);
  });

  it('reads the message of a thrown Error and its classified code', () => {
    const error = Object.assign(new Error(`LLM stream error: could not fetch ${ALIVE}`), {
      errorType: AgentRuntimeErrorType.RemoteMediaDownloadFailed,
    });

    expect(findUnreachableMediaUrl(error, history)).toBe(ALIVE);
  });

  it('ignores errors that are not media download failures', () => {
    const error = {
      error: { message: `Invalid request near ${DEAD}` },
      errorType: 'ProviderBizError',
    };

    expect(findUnreachableMediaUrl(error, history)).toBeUndefined();
  });

  it('does not guess when the provider names no link from the request', () => {
    const error = {
      error: { message: 'Error while downloading https://example.com/x.png' },
      errorType: AgentRuntimeErrorType.RemoteMediaDownloadFailed,
    };

    expect(findUnreachableMediaUrl(error, history)).toBeUndefined();
  });
});

describe('stripUnreachableMedia', () => {
  it('replaces only the dead link with a note and keeps other messages as-is', () => {
    const result = stripUnreachableMedia(history, new Set([DEAD]));

    expect(result[0]).toBe(history[0]);
    expect(result[1].content).toEqual([
      { text: 'look', type: 'text' },
      { text: expect.stringContaining('Image unavailable'), type: 'text' },
      { image_url: { url: ALIVE }, type: 'image_url' },
    ]);
  });
});

describe('redactMediaUrl', () => {
  it('drops the query so presigned signatures stay out of logs', () => {
    expect(redactMediaUrl('https://s3.example.com/a/b.png?X-Amz-Signature=secret')).toBe(
      'https://s3.example.com/a/b.png',
    );
  });
});
