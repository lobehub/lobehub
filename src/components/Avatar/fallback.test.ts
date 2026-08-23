import { describe, expect, it } from 'vitest';

import { getAvatarInitials, remoteAvatarSrc, resolveAvatar } from './fallback';

describe('getAvatarInitials', () => {
  it('returns nothing for a missing name', () => {
    expect(getAvatarInitials()).toBe('');
    expect(getAvatarInitials(null)).toBe('');
    expect(getAvatarInitials('   ')).toBe('');
  });

  it('keeps a single glyph for ideographic names', () => {
    expect(getAvatarInitials('贺素青')).toBe('贺');
    expect(getAvatarInitials('验证-存活 worktree 对话')).toBe('验');
    expect(getAvatarInitials('ミク')).toBe('ミ');
    expect(getAvatarInitials('한국어')).toBe('한');
  });

  it('takes the initials of the first two words for latin names', () => {
    expect(getAvatarInitials('Claude Code')).toBe('CC');
    expect(getAvatarInitials('agent-default')).toBe('AD');
    expect(getAvatarInitials('data_science.helper')).toBe('DS');
  });

  it('takes the first two letters of a single word', () => {
    expect(getAvatarInitials('lobehub')).toBe('LO');
    expect(getAvatarInitials('x')).toBe('X');
  });

  it('keeps a leading emoji so the avatar can render it as an emoji', () => {
    expect(getAvatarInitials('🤖 helper')).toBe('🤖');
  });
});

describe('resolveAvatar', () => {
  it('keeps a working avatar and its background untouched', () => {
    expect(
      resolveAvatar({ avatar: 'https://example.com/a.png', background: '#123456', name: '贺素青' }),
    ).toEqual({ avatar: 'https://example.com/a.png', background: '#123456' });
  });

  it('falls back to the name initials when the image is broken', () => {
    const { avatar, background } = resolveAvatar({
      avatar: 'https://example.com/gone.png',
      isBroken: true,
      name: '贺素青',
    });

    expect(avatar).toBe('贺');
    // The name picks the glyphs, never the color — the tile stays the Avatar's
    // own neutral grey so a random hue never reads as status.
    expect(background).toBeUndefined();
  });

  it('gives every unconfigured name the same neutral tile', () => {
    const seeds = ['贺素青', 'Claude Code', 'lobehub', 'agent-default', 'Verify', 'Inbox'];
    const backgrounds = new Set(seeds.map((name) => resolveAvatar({ name }).background));

    expect(backgrounds).toEqual(new Set([undefined]));
  });

  it('falls back when there is no avatar at all', () => {
    expect(resolveAvatar({ title: 'Claude Code' }).avatar).toBe('CC');
  });

  it('renders an empty tile rather than "UN" or a URL fragment when unnamed', () => {
    expect(resolveAvatar({}).avatar).toBe('');

    const broken = resolveAvatar({ avatar: '/avatars/agent-default.png', isBroken: true });
    expect(broken.avatar).toBe('');
    expect(broken.background).toBeUndefined();
  });

  it('keeps an explicitly chosen background even when the image is broken', () => {
    expect(
      resolveAvatar({ avatar: '/gone.png', background: '#abcdef', isBroken: true, name: 'Verify' })
        .background,
    ).toBe('#abcdef');
  });

  it('prefers `name` over `title` as the seed', () => {
    expect(resolveAvatar({ name: 'Verify Runner', title: 'open the verify runner' }).avatar).toBe(
      'VR',
    );
  });
});

describe('remoteAvatarSrc', () => {
  it('only matches URLs, not emoji or nodes', () => {
    expect(remoteAvatarSrc('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(remoteAvatarSrc('/avatars/agent-default.png')).toBe('/avatars/agent-default.png');
    expect(remoteAvatarSrc('🤖')).toBeUndefined();
    expect(remoteAvatarSrc(undefined)).toBeUndefined();
  });
});

describe('resolveAvatar background sentinels', () => {
  it('treats a transparent background as unset when falling back', () => {
    const { background } = resolveAvatar({
      avatar: '/gone.png',
      background: 'transparent',
      isBroken: true,
      name: '林知微',
    });

    // Dropped rather than forwarded, so the Avatar paints `colorBorder` behind
    // the initials instead of leaving them on the page background.
    expect(background).toBeUndefined();
  });

  it('also ignores rgba(0, 0, 0, 0)', () => {
    expect(
      resolveAvatar({ background: 'rgba(0, 0, 0, 0)', name: 'Verify' }).background,
    ).toBeUndefined();
  });

  it('keeps a transparent background behind a working image', () => {
    expect(
      resolveAvatar({ avatar: 'https://example.com/a.png', background: 'transparent' }).background,
    ).toBe('transparent');
  });
});
