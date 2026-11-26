import { Center, cssVar, Icon, Tooltip } from '@lobehub/ui';
import { CircleUser } from 'lucide-react';
import { memo } from 'react';

import UserAvatar from '@/components/UserAvatar';
import MemberProfilePopup from '@/features/MemberProfileCard/MemberProfilePopup';

import { useUserDisplayMeta } from '../shared/useUserDisplayMeta';

interface AssigneeUserAvatarProps {
  /**
   * Show the member's profile card on hover; takes precedence over `tooltip`.
   * Falls back to the name tooltip for someone outside the workspace directory.
   */
  profileCard?: boolean;
  size?: number;
  tooltip?: boolean;
  userId?: string | null;
}

/** Human-assignee twin of `AssigneeAvatar` (which renders agent assignees). */
const AssigneeUserAvatar = memo<AssigneeUserAvatarProps>(
  ({ profileCard, userId, size = 18, tooltip }) => {
    const displayMeta = useUserDisplayMeta(userId);

    if (!displayMeta) {
      return (
        <Center
          height={size}
          width={size}
          style={{
            borderRadius: '50%',
            color: cssVar.colorTextQuaternary,
            flexShrink: 0,
          }}
        >
          <Icon icon={CircleUser} size={size} />
        </Center>
      );
    }

    const avatar = (
      <UserAvatar
        avatar={displayMeta.avatar}
        name={displayMeta.title}
        shape={'circle'}
        size={size}
        variant={'outlined'}
      />
    );

    const withTooltip = <Tooltip title={displayMeta.title}>{avatar}</Tooltip>;

    if (profileCard)
      return (
        <MemberProfilePopup fallback={withTooltip} userId={userId}>
          {avatar}
        </MemberProfilePopup>
      );

    return tooltip ? withTooltip : avatar;
  },
);

export default AssigneeUserAvatar;
