import type { AcceptanceCommentItem } from '@lobechat/types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CommentCard from './CommentCard';

vi.mock('@/hooks/useActivityTime', () => ({
  useActivityTime: () => ({ text: 'just now', title: 'just now' }),
}));
// Desktop renders from `app://renderer`; shared links must use the server origin instead.
vi.mock('@/hooks/useAppOrigin', () => ({ useAppOrigin: () => 'https://app.lobehub.com' }));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({ userProfileSelectors: { userId: () => 'user-1' } }));
vi.mock('./CommentContent', () => ({ default: () => null }));
vi.mock('./CommentReactions', () => ({ default: () => null }));

const comment = {
  author: { fullName: 'Reviewer', status: 'active', type: 'user' },
  authorUserId: 'user-2',
  canDelete: false,
  createdAt: new Date('2026-10-21T00:00:00Z'),
  id: 'c1',
} as unknown as AcceptanceCommentItem;

afterEach(cleanup);

describe('CommentCard permalink', () => {
  it('copies the comment link under the app origin, not the page origin', async () => {
    window.history.replaceState(null, '', '/lobehub/project/p1/acceptance/a1');
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard);
    render(<CommentCard anchored comment={comment} />);

    fireEvent.click(screen.getByTitle('acceptance.comments.copyLinkHint'));

    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'https://app.lobehub.com/lobehub/project/p1/acceptance/a1#comment-c1',
      ),
    );
  });
});
