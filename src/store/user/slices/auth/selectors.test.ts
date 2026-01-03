import { BRANDING_NAME } from '@lobechat/business-const';
import { t } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserStore } from '@/store/user';

import { authSelectors, userProfileSelectors } from './selectors';

vi.mock('i18next', () => ({
  t: vi.fn((key) => key),
}));

// 定义一个变量来存储 enableAuth 的值
let enableAuth = true;
let isDesktop = false;

// 模拟 @/const/auth 模块
vi.mock('@/const/auth', () => ({
  get enableAuth() {
    return enableAuth;
  },
}));

// 模拟 @/const/version 模块
vi.mock('@/const/version', () => ({
  get isDesktop() {
    return isDesktop;
  },
}));

afterEach(() => {
  enableAuth = true;
  isDesktop = false;
});

describe('userProfileSelectors', () => {
  describe('displayUserName', () => {
    it('should return default username when auth is disabled and not desktop', () => {
      enableAuth = false;
      isDesktop = false;

      const store: UserStore = {
        isSignedIn: false,
        user: null,
        enableAuth: () => false,
      } as unknown as UserStore;

      expect(userProfileSelectors.displayUserName(store)).toBe(BRANDING_NAME);
    });

    it('should return user username when auth is disabled and is desktop', () => {
      enableAuth = false;
      isDesktop = true;

      const store: UserStore = {
        isSignedIn: false,
        user: { username: 'johndoe' },
        enableAuth: () => false,
      } as unknown as UserStore;

      expect(userProfileSelectors.displayUserName(store)).toBe('johndoe');
    });

    it('should return user username when signed in', () => {
      const store: UserStore = {
        isSignedIn: true,
        user: { username: 'johndoe' },
        enableAuth: () => true,
      } as UserStore;

      expect(userProfileSelectors.displayUserName(store)).toBe('johndoe');
    });

    it('should return email when signed in but username is not existed in UserStore', () => {
      const store: UserStore = {
        isSignedIn: true,
        user: { email: 'demo@lobehub.com' },
        enableAuth: () => true,
      } as UserStore;

      expect(userProfileSelectors.displayUserName(store)).toBe('demo@lobehub.com');
    });

    it('should return "anonymous" when not signed in', () => {
      const store: UserStore = {
        enableAuth: () => true,
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
    it('should return default nickname when auth is disabled and not desktop', () => {
      enableAuth = false;
      isDesktop = false;

      const store: UserStore = {
        isSignedIn: false,
        user: null,
        enableAuth: () => false,
      } as unknown as UserStore;

      expect(userProfileSelectors.nickName(store)).toBe('userPanel.defaultNickname');
      expect(t).toHaveBeenCalledWith('userPanel.defaultNickname', { ns: 'common' });
    });

    it('should return user fullName when auth is disabled and is desktop', () => {
      enableAuth = false;
      isDesktop = true;

      const store: UserStore = {
        isSignedIn: false,
        user: { fullName: 'John Doe' },
        enableAuth: () => false,
      } as unknown as UserStore;

      expect(userProfileSelectors.nickName(store)).toBe('John Doe');
    });

    it('should return user fullName when signed in', () => {
      enableAuth = true;

      const store: UserStore = {
        isSignedIn: true,
        user: { fullName: 'John Doe' },
        enableAuth: () => true,
      } as UserStore;

      expect(userProfileSelectors.nickName(store)).toBe('John Doe');
    });

    it('should return user username when fullName is not available', () => {
      const store: UserStore = {
        isSignedIn: true,
        user: { username: 'johndoe' },
        enableAuth: () => true,
      } as UserStore;

      expect(userProfileSelectors.nickName(store)).toBe('johndoe');
    });

    it('should return anonymous nickname when not signed in', () => {
      enableAuth = true;

      const store: UserStore = {
        enableAuth: () => true,
        isSignedIn: false,
        user: null,
      } as unknown as UserStore;

      expect(userProfileSelectors.nickName(store)).toBe('userPanel.anonymousNickName');
      expect(t).toHaveBeenCalledWith('userPanel.anonymousNickName', { ns: 'common' });
    });
  });

  describe('username', () => {
    it('should return default username when auth is disabled and not desktop', () => {
      enableAuth = false;
      isDesktop = false;

      const store: UserStore = {
        isSignedIn: false,
        user: null,
        enableAuth: () => false,
      } as unknown as UserStore;

      expect(userProfileSelectors.username(store)).toBe(BRANDING_NAME);
    });

    it('should return user username when auth is disabled and is desktop', () => {
      enableAuth = false;
      isDesktop = true;

      const store: UserStore = {
        isSignedIn: false,
        user: { username: 'johndoe' },
        enableAuth: () => false,
      } as unknown as UserStore;

      expect(userProfileSelectors.username(store)).toBe('johndoe');
    });

    it('should return user username when signed in', () => {
      const store: UserStore = {
        isSignedIn: true,
        user: { username: 'johndoe' },
        enableAuth: () => true,
      } as UserStore;

      expect(userProfileSelectors.username(store)).toBe('johndoe');
    });

    it('should return "anonymous" when not signed in', () => {
      const store: UserStore = {
        enableAuth: () => true,
        isSignedIn: false,
        user: null,
      } as unknown as UserStore;

      expect(userProfileSelectors.username(store)).toBe('anonymous');
    });
  });
});

describe('authSelectors', () => {
  describe('isLogin', () => {
    it('should return false when not signed in (regardless of auth enabled state)', () => {
      enableAuth = false;

      const store: UserStore = {
        isSignedIn: false,
        enableAuth: () => false,
      } as UserStore;

      // isLogin now only checks isSignedIn, not enableAuth
      expect(authSelectors.isLogin(store)).toBe(false);
    });

    it('should return true when signed in', () => {
      const store: UserStore = {
        isSignedIn: true,
        enableAuth: () => true,
      } as UserStore;

      expect(authSelectors.isLogin(store)).toBe(true);
    });

    it('should return false when not signed in and auth is enabled', () => {
      const store: UserStore = {
        isSignedIn: false,
        enableAuth: () => true,
      } as UserStore;

      expect(authSelectors.isLogin(store)).toBe(false);
    });
  });
});
