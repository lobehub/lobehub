import { describe, expect, it } from 'vitest';

import { stripSpeakerTags } from './inputPreview';

describe('stripSpeakerTags', () => {
  it('drops the speaker envelope and keeps the message', () => {
    expect(
      stripSpeakerTags(
        '<speaker id="o9cq@im.wechat"\nusername="o9cq@im.wechat"\nnickname="x" />\n不是 你不知道我是谁吗',
      ),
    ).toBe('不是 你不知道我是谁吗');
  });

  it('leaves plain text alone', () => {
    expect(stripSpeakerTags('hello <b>world</b>')).toBe('hello <b>world</b>');
  });
});
