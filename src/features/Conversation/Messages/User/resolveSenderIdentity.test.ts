import { describe, expect, it } from 'vitest';

import { resolveSenderIdentity } from './resolveSenderIdentity';

const viewer = {
  currentUserId: 'user-viewer',
  selfAvatar: 'https://a.com/viewer.png',
  selfTitle: 'Viewer',
  unknownLabel: 'Member',
};

describe('resolveSenderIdentity', () => {
  it('uses the sender profile for another member', () => {
    expect(
      resolveSenderIdentity({
        ...viewer,
        sender: {
          avatar: 'https://a.com/kermit.png',
          fullName: 'Kermit',
          id: 'user-kermit',
          username: null,
        },
      }),
    ).toEqual({ avatar: 'https://a.com/kermit.png', isOwn: false, title: 'Kermit' });
  });

  it('never falls back to the viewer identity for another member without avatar', () => {
    const result = resolveSenderIdentity({
      ...viewer,
      sender: { avatar: null, fullName: 'Kermit', id: 'user-kermit', username: null },
    });

    expect(result.title).toBe('Kermit');
    // No picture at all, so the Avatar renders initials from the title — the
    // viewer's own avatar must never stand in for another member.
    expect(result.avatar).toBeUndefined();
  });

  it('labels another nameless member as unknown instead of impersonating the viewer', () => {
    const result = resolveSenderIdentity({
      ...viewer,
      sender: { avatar: null, fullName: null, id: 'user-kermit', username: null },
    });

    expect(result).toEqual({ avatar: undefined, isOwn: false, title: 'Member' });
  });

  it('falls back to username when fullName is missing', () => {
    const result = resolveSenderIdentity({
      ...viewer,
      sender: { avatar: null, fullName: null, id: 'user-kermit', username: 'kermit' },
    });

    expect(result.title).toBe('kermit');
  });

  it('keeps self identity for the viewer own resolved sender', () => {
    const result = resolveSenderIdentity({
      ...viewer,
      sender: { avatar: null, fullName: null, id: 'user-viewer', username: null },
    });

    expect(result).toEqual({ avatar: viewer.selfAvatar, isOwn: true, title: 'Viewer' });
  });

  it('treats sender-less rows as the viewer own optimistic message', () => {
    const result = resolveSenderIdentity({ ...viewer, sender: null });

    expect(result).toEqual({ avatar: viewer.selfAvatar, isOwn: true, title: 'Viewer' });
  });

  it('prefers the sender own name over the viewer profile for own messages', () => {
    const result = resolveSenderIdentity({
      ...viewer,
      sender: { avatar: null, fullName: 'Real Name', id: 'user-viewer', username: null },
    });

    expect(result.title).toBe('Real Name');
    expect(result.avatar).toBe(viewer.selfAvatar);
  });
});
