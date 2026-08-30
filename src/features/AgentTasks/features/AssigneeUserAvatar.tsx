import { Center, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CircleUser } from 'lucide-react';
import { memo } from 'react';

import Avatar from '@/components/Avatar';

import { useUserDisplayMeta } from '../shared/useUserDisplayMeta';

interface AssigneeUserAvatarProps {
  size?: number;
  userId?: string | null;
}

/** Human-assignee twin of `AssigneeAvatar` (which renders agent assignees). */
const AssigneeUserAvatar = memo<AssigneeUserAvatarProps>(({ userId, size = 18 }) => {
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

  return (
    <Avatar
      avatar={displayMeta.avatar || undefined}
      name={displayMeta.title || undefined}
      shape={'circle'}
      size={size}
      title={displayMeta.title || undefined}
      variant={'outlined'}
    />
  );
});

export default AssigneeUserAvatar;
