import { useAuthorInfo } from '@/business/client/hooks/useAuthorInfo';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

export interface UserDisplayMeta {
  avatar?: string | null;
  title?: string | null;
}

/**
 * Resolve a human task assignee's display profile. Member metadata is
 * optional, so fall back to the signed-in user's profile for a personal-mode
 * self-assignment when no member directory is available.
 */
export const useUserDisplayMeta = (userId?: string | null): UserDisplayMeta | undefined => {
  const author = useAuthorInfo(userId ?? undefined);
  const isSelf = useUserStore((s) => Boolean(userId) && userProfileSelectors.userId(s) === userId);
  const selfAvatar = useUserStore(userProfileSelectors.userAvatar);
  const selfName = useUserStore(userProfileSelectors.displayUserName);

  if (!userId) return undefined;
  if (author) return { avatar: author.avatar, title: author.fullName };
  if (isSelf) return { avatar: selfAvatar, title: selfName };
  return undefined;
};
