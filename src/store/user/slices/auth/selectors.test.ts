import { t } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type UserStore } from '@/store/user';

import { authSelectors, userProfileSelectors } from './selectors';

vi.mock('i18next', () => ({
  t: vi.fn((key) => key),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('userProfileSelectors', () => {
  describe('displayUserName', () => {
    it('should return user username when signed in', () => {
      const store: UserStore = {
        isSignedIn: true,
        user: { username: 'johndoe' },
      } as UserStore;

      expect(userProfileSelectors.displayUserName(store)).toBe('johndoe');
    });

    it('should return email when signed in but username is not existed in UserStore', () => {
      const store: UserStore = {
        isSignedIn: true,
        user: { email: 'demo@lobehub.com' },
      } as UserStore;

      expect(userProfileSelectors.displayUserName(store)).toBe('demo@lobehub.com');
    });

    it('should return "anonymous" when not signed in', () => {
      const store: UserStore = {
        isSignedIn: false,
        user: null,
      } as unknown as UserStore;

      expect(userProfileSelectors.displayUserName(store)).toBe('anonymous');
    });
  });

  describe('email', () => {
    it('should return user email if exist', () => {
      const store: UserStore = {
        user: { email: 'demo@lobehub.com' },
      } as UserStore;

      expect(userProfileSelectors.email(store)).toBe('demo@lobehub.com');
    });

    it('should return empty string if not exist', () => {
      const store: UserStore = {
        user: { email: undefined },
      } as UserStore;

      expect(userProfileSelectors.email(store)).toBe('');
    });
  });

  describe('fullName', () => {
    it('should return user fullName if exist', () => {
      const store: UserStore = {
        user: { fullName: 'John Doe' },
      } as UserStore;

      expect(userProfileSelectors.fullName(store)).toBe('John Doe');
    });

    it('should return empty string if not exist', () => {
      const store: UserStore = {
        user: { fullName: undefined },
      } as UserStore;

      expect(userProfileSelectors.fullName(store)).toBe('');
    });
  });

  describe('nickName', () => {
    it('should return user fullName when signed in', () => {
      const store: UserStore = {
        isSignedIn: true,
        user: { fullName: 'John Doe' },
      } as UserStore;

      expect(userProfileSelectors.nickName(store)).toBe('John Doe');
    });

    it('should return user username when fullName is not available', () => {
      const store: UserStore = {
        isSignedIn: true,
        user: { username: 'johndoe' },
      } as UserStore;

      expect(userProfileSelectors.nickName(store)).toBe('johndoe');
    });

    it('should return anonymous nickname when not signed in', () => {
      const store: UserStore = {
        isSignedIn: false,
        user: null,
      } as unknown as UserStore;

      expect(userProfileSelectors.nickName(store)).toBe('userPanel.anonymousNickName');
      expect(t).toHaveBeenCalledWith('userPanel.anonymousNickName', { ns: 'common' });
    });
  });

  describe('username', () => {
    it('should return user username when signed in', () => {
      const store: UserStore = {
        isSignedIn: true,
        user: { username: 'johndoe' },
      } as UserStore;

      expect(userProfileSelectors.username(store)).toBe('johndoe');
    });

    it('should return "anonymous" when not signed in', () => {
      const store: UserStore = {
        isSignedIn: false,
        user: null,
      } as unknown as UserStore;

      expect(userProfileSelectors.username(store)).toBe('anonymous');
    });
  });
});

describe('authSelectors', () => {
  describe('isLogin', () => {
    it('should return true when signed in', () => {
      const store: UserStore = {
        isSignedIn: true,
      } as UserStore;

      expect(authSelectors.isLogin(store)).toBe(true);
    });

    it('should return false when not signed in', () => {
      const store: UserStore = {
        isSignedIn: false,
      } as UserStore;

      expect(authSelectors.isLogin(store)).toBe(false);
    });
  });
});
