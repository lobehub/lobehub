import { BRANDING_NAME } from '@lobechat/business-const';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DEFAULT_USER_AVATAR_URL } from '@/const/meta';
import { useUserStore } from '@/store/user';

import UserAvatar from '../UserAvatar';

describe('UserAvatar', () => {
  it('should show the username and avatar are displayed when the user is logged in', async () => {
    const mockAvatar = 'https://example.com/avatar.png';
    const mockUsername = 'teeeeeestuser';

    act(() => {
      useUserStore.setState({
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
        isSignedIn: true,
        user: { id: 'bbb', username: mockUsername },
      });
    });

    render(<UserAvatar />);
    // With no avatar url, <Avatar /> draws a fallback generated from the name: an <svg>
    // labelled with the username, not an <img />
    const fallback = screen.getByRole('img', { name: mockUsername });
    expect(fallback.tagName.toLowerCase()).toBe('svg');
    // A person draws the pixel variant: a grid of 10×10 cells
    expect(fallback.querySelectorAll('rect[width="10"][height="10"]').length).toBeGreaterThan(0);
    expect(screen.queryByAltText(mockUsername)).not.toBeInTheDocument();
  });

  it('updates a mounted personal avatar when the profile picture changes', () => {
    act(() => {
      useUserStore.setState({
        isSignedIn: true,
        user: { avatar: 'https://example.com/old.png', id: 'self', username: 'Profile update' },
      });
    });
    render(<UserAvatar size={36} />);
    expect(screen.getByAltText('Profile update')).toHaveAttribute(
      'src',
      'https://example.com/old.png',
    );

    act(() => {
      useUserStore.setState({
        user: { avatar: 'https://example.com/new.png', id: 'self', username: 'Profile update' },
      });
    });
    expect(screen.getByAltText('Profile update')).toHaveAttribute(
      'src',
      'https://example.com/new.png',
    );
  });

  it('should show LobeChat and default avatar when the user is not logged in', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: false, user: undefined });
    });

    render(<UserAvatar />);
    expect(screen.getByAltText(BRANDING_NAME)).toBeInTheDocument();
    expect(screen.getByAltText(BRANDING_NAME)).toHaveAttribute('src', DEFAULT_USER_AVATAR_URL);
  });
});
