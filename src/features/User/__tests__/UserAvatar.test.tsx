import { BRANDING_NAME } from '@lobechat/business-const';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_USER_AVATAR_URL } from '@/const/meta';
import { useUserStore } from '@/store/user';

import UserAvatar from '../UserAvatar';

vi.mock('zustand/traditional');

// Use vi.hoisted to ensure variables exist before vi.mock factory executes
const { enableAuth, enableClerk, enableNextAuth } = vi.hoisted(() => ({
  enableAuth: { value: true },
  enableClerk: { value: false },
  enableNextAuth: { value: false },
}));

vi.mock('@/envs/auth', () => ({
  get enableAuth() {
    return enableAuth.value;
  },
  get enableClerk() {
    return enableClerk.value;
  },
  get enableNextAuth() {
    return enableNextAuth.value;
  },
}));

afterEach(() => {
  enableAuth.value = true;
  enableClerk.value = false;
  enableNextAuth.value = false;
});

describe('UserAvatar', () => {
  describe('enable Auth', () => {
    it('should show the username and avatar are displayed when the user is logged in', async () => {
      const mockAvatar = 'https://example.com/avatar.png';
      const mockUsername = 'teeeeeestuser';

      act(() => {
        useUserStore.setState({
          enableAuth: () => true,
          isSignedIn: true,
          user: { avatar: mockAvatar, id: 'abc', username: mockUsername },
        });
      });

      render(<UserAvatar />);

      expect(screen.getByAltText(mockUsername)).toBeInTheDocument();
      expect(screen.getByAltText(mockUsername)).toHaveAttribute('src', mockAvatar);
    });

    it('should show default avatar when the user is logged in but have no custom avatar', () => {
      const mockUsername = 'testuser';

      act(() => {
        useUserStore.setState({
          enableAuth: () => true,
          isSignedIn: true,
          user: { id: 'bbb', username: mockUsername },
        });
      });

      render(<UserAvatar />);
      // When user has no avatar url, <Avatar /> falls back to initials rendering (not an <img />)
      expect(screen.getByText('TE')).toBeInTheDocument();
    });

    it('should show LobeChat and default avatar when the user is not logged in and enable auth', () => {
      act(() => {
        useUserStore.setState({ enableAuth: () => true, isSignedIn: false, user: undefined });
      });

      render(<UserAvatar />);
      expect(screen.getByAltText(BRANDING_NAME)).toBeInTheDocument();
      expect(screen.getByAltText(BRANDING_NAME)).toHaveAttribute('src', DEFAULT_USER_AVATAR_URL);
    });
  });

  describe('disable Auth', () => {
    it('should show LobeChat and default avatar when the user is not logged in and disabled auth', () => {
      enableAuth.value = false;
      act(() => {
        useUserStore.setState({ enableAuth: () => false, isSignedIn: false, user: undefined });
      });

      render(<UserAvatar />);
      expect(screen.getByAltText(BRANDING_NAME)).toBeInTheDocument();
      expect(screen.getByAltText(BRANDING_NAME)).toHaveAttribute('src', DEFAULT_USER_AVATAR_URL);
    });
  });
});
