import { Center, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CircleUser } from 'lucide-react';
import { memo } from 'react';

import Avatar from '@/components/Avatar';

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
    <Avatar
      avatar={displayMeta.avatar || undefined}
      name={displayMeta.title || undefined}
      shape={'circle'}
      size={size}
      title={displayMeta.title || undefined}
      variant={'outlined'}
    />
  );

  return tooltip ? <Tooltip title={displayMeta.title}>{avatar}</Tooltip> : avatar;
});

export default AssigneeUserAvatar;
