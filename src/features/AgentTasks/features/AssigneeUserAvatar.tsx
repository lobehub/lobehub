import { Center, cssVar, Icon, Tooltip } from '@lobehub/ui';
import { CircleUser } from 'lucide-react';
import { memo } from 'react';

import UserAvatar from '@/components/UserAvatar';

import { useUserDisplayMeta } from '../shared/useUserDisplayMeta';

interface AssigneeUserAvatarProps {
  size?: number;
  tooltip?: boolean;
  userId?: string | null;
}

/** Human-assignee twin of `AssigneeAvatar` (which renders agent assignees). */
const AssigneeUserAvatar = memo<AssigneeUserAvatarProps>(({ userId, size = 18, tooltip }) => {
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

  return tooltip ? <Tooltip title={displayMeta.title}>{avatar}</Tooltip> : avatar;
});

export default AssigneeUserAvatar;
