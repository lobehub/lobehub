import type { ChannelPublicMember } from '@lobechat/types';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';
import UserAvatar from '@/features/User/UserAvatar';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { isCurrentUserMember, memberAvatar, memberName } from './memberName';

export function MemberAvatar({ member, size }: { member: ChannelPublicMember; size: number }) {
  const { t } = useTranslation('channel');
  const isSelf = useUserStore((s) => isCurrentUserMember(member, userProfileSelectors.userId(s)));
  const name = memberName(member, t('deletedMember'));
  return isSelf ? (
    <UserAvatar size={size} />
  ) : (
    <Avatar avatar={memberAvatar(member)} size={size} title={name} />
  );
}
