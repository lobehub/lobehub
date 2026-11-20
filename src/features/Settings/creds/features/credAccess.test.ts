import { type UserCredSummary } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { isOwnCredRow, workspaceCredRowAccess } from './credAccess';

const ME = 42;
const OTHER = 99;

const row = (overrides: Partial<UserCredSummary>): UserCredSummary => ({
  createdAt: '2024-01-01T00:00:00.000Z',
  id: 1,
  key: 'GITHUB_TOKEN',
  name: 'GitHub',
  type: 'kv-env',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const member = { isAdmin: false, myAccountId: ME };
const admin = { isAdmin: true, myAccountId: ME };

describe('isOwnCredRow', () => {
  it('is true only for my own personal credential', () => {
    expect(isOwnCredRow(row({ ownerAccountId: ME, ownerType: 'user' }), ME)).toBe(true);
    expect(isOwnCredRow(row({ ownerAccountId: OTHER, ownerType: 'user' }), ME)).toBe(false);
    expect(isOwnCredRow(row({ ownerAccountId: ME, ownerType: 'organization' }), ME)).toBe(false);
  });

  it('is false while my account id is unknown', () => {
    expect(isOwnCredRow(row({ ownerType: 'user' }), undefined)).toBe(false);
  });
});

describe('workspaceCredRowAccess', () => {
  describe('workspace credentials', () => {
    it('lets the creator manage and publish a private one', () => {
      const cred = row({
        createdByAccountId: ME,
        ownerType: 'organization',
        visibility: 'private',
      });

      expect(workspaceCredRowAccess(cred, member)).toEqual({
        makePrivate: false,
        manage: true,
        publish: true,
        unshare: false,
      });
    });

    it('lets the creator take a published one back', () => {
      const cred = row({ createdByAccountId: ME, ownerType: 'organization', visibility: 'public' });

      expect(workspaceCredRowAccess(cred, member)).toMatchObject({
        makePrivate: true,
        manage: true,
        publish: false,
      });
    });

    it("lets an admin manage another member's shared one but not change its visibility", () => {
      const cred = row({
        createdByAccountId: OTHER,
        ownerType: 'organization',
        visibility: 'public',
      });

      expect(workspaceCredRowAccess(cred, admin)).toEqual({
        makePrivate: false,
        manage: true,
        publish: false,
        unshare: false,
      });
    });

    it("gives a member nothing on another member's shared one", () => {
      const cred = row({
        createdByAccountId: OTHER,
        ownerType: 'organization',
        visibility: 'public',
      });

      expect(workspaceCredRowAccess(cred, member)).toEqual({
        makePrivate: false,
        manage: false,
        publish: false,
        unshare: false,
      });
    });

    it('leaves a credential with no recorded creator to admins', () => {
      const cred = row({ ownerType: 'organization', visibility: 'public' });

      expect(workspaceCredRowAccess(cred, admin).manage).toBe(true);
      expect(workspaceCredRowAccess(cred, admin).makePrivate).toBe(false);
      expect(workspaceCredRowAccess(cred, member).manage).toBe(false);
    });
  });

  describe('shared personal credentials', () => {
    it('lets the owner publish a private share or unshare it, but edit it only on the personal page', () => {
      const cred = row({ ownerAccountId: ME, ownerType: 'user', visibility: 'private' });

      expect(workspaceCredRowAccess(cred, member)).toEqual({
        makePrivate: false,
        manage: false,
        publish: true,
        unshare: true,
      });
    });

    it('lets the owner take a published share back', () => {
      const cred = row({ ownerAccountId: ME, ownerType: 'user', visibility: 'public' });

      expect(workspaceCredRowAccess(cred, member)).toMatchObject({
        makePrivate: true,
        publish: false,
      });
    });

    it("lets only an admin remove another member's published share", () => {
      const cred = row({ ownerAccountId: OTHER, ownerType: 'user', visibility: 'public' });

      expect(workspaceCredRowAccess(cred, admin)).toEqual({
        makePrivate: false,
        manage: false,
        publish: false,
        unshare: true,
      });
      expect(workspaceCredRowAccess(cred, member).unshare).toBe(false);
    });
  });
});
