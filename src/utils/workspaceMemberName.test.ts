import { describe, expect, it } from 'vitest';

import {
  getWorkspaceMemberName,
  getWorkspaceMemberNickname,
  getWorkspaceMemberSearchLabels,
} from './workspaceMemberName';

const member = {
  user: { email: 'mira@example.com', fullName: 'Mira Chen', username: 'mira' },
  userId: 'u1',
};

describe('getWorkspaceMemberName', () => {
  it('prefers the workspace nickname over the account name', () => {
    expect(getWorkspaceMemberName({ ...member, config: { nickname: 'Kuro' } })).toBe('Kuro');
  });

  it('falls back to full name, handle, email, then the user id', () => {
    expect(getWorkspaceMemberName({ ...member, config: { nickname: '  ' } })).toBe('Mira Chen');
    expect(getWorkspaceMemberName({ ...member, user: { ...member.user, fullName: ' ' } })).toBe(
      'mira',
    );
    expect(getWorkspaceMemberName({ user: { email: 'a@b.c' }, userId: 'u2' })).toBe('a@b.c');
    expect(getWorkspaceMemberName({ user: null, userId: 'u3' })).toBe('u3');
  });

  it('can shorten an email and replace the id fallback', () => {
    const emailOnly = { user: { email: 'kermit@lobehub.com' }, userId: 'u4' };
    expect(getWorkspaceMemberName(emailOnly, { emailLocalPart: true })).toBe('kermit');
    expect(getWorkspaceMemberName({ userId: 'u5' }, { fallback: '' })).toBe('');
  });
});

describe('getWorkspaceMemberNickname', () => {
  it('treats a blank nickname as unset', () => {
    expect(getWorkspaceMemberNickname({ config: { nickname: ' Kuro ' } })).toBe('Kuro');
    expect(getWorkspaceMemberNickname({ config: { nickname: '' } })).toBeUndefined();
    expect(getWorkspaceMemberNickname({ config: {} })).toBeUndefined();
    expect(getWorkspaceMemberNickname({})).toBeUndefined();
  });
});

describe('getWorkspaceMemberSearchLabels', () => {
  it('lists the nickname alongside the account names', () => {
    expect(getWorkspaceMemberSearchLabels({ ...member, config: { nickname: 'Kuro' } })).toEqual([
      'Kuro',
      'Mira Chen',
      'mira',
      'mira@example.com',
    ]);
  });
});
