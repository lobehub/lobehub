import { describe, expect, it } from 'vitest';

import { parseSpeakerTag } from './parseSpeakerTag';

describe('parseSpeakerTag', () => {
  it('returns undefined for plain content', () => {
    expect(parseSpeakerTag('hello')).toBeUndefined();
    expect(parseSpeakerTag('')).toBeUndefined();
    expect(parseSpeakerTag(null)).toBeUndefined();
  });

  it('ignores group-chat speaker tags without an id', () => {
    expect(parseSpeakerTag('<speaker name="Weather Expert" />\nhi')).toBeUndefined();
  });

  it('parses a Feishu style tag (name only)', () => {
    expect(parseSpeakerTag('<speaker id="ou_1" username="文彬" nickname="文彬" />\nhi')).toEqual({
      avatar: undefined,
      fullName: '文彬',
      id: 'ou_1',
      platform: 'unknown',
      username: undefined,
    });
  });

  it('resolves a Discord avatar hash against the CDN', () => {
    expect(
      parseSpeakerTag('<speaker id="123" username="john" nickname="John Doe" avatar="abc" />\nhi'),
    ).toEqual({
      avatar: 'https://cdn.discordapp.com/avatars/123/abc.png',
      fullName: 'John Doe',
      id: '123',
      platform: 'discord',
      username: 'john',
    });
  });

  it('keeps an absolute avatar url', () => {
    expect(parseSpeakerTag('<speaker id="u1" avatar="https://x/a.png" />\nhi')?.avatar).toBe(
      'https://x/a.png',
    );
  });
});
