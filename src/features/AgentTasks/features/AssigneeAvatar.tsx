import { Avatar, Center, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { UserRound } from 'lucide-react';
import { memo } from 'react';

import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';

interface AssigneeAvatarProps {
  agentId?: string | null;
  size?: number;
}

const AssigneeAvatar = memo<AssigneeAvatarProps>(({ agentId, size = 18 }) => {
  const displayMeta = useAgentDisplayMeta(agentId);

  if (!displayMeta) {
    return (
      <Center
        height={size}
        width={size}
        style={{
          border: `1px dashed ${cssVar.colorBorder}`,
          borderRadius: '50%',
          color: cssVar.colorTextQuaternary,
          flexShrink: 0,
        }}
      >
        <Icon icon={UserRound} size={size - 6} />
      </Center>
    );
  }

  return (
    <Avatar
      avatar={displayMeta.avatar}
      background={displayMeta.backgroundColor || cssVar.colorBgContainer}
      shape={'circle'}
      size={size}
      title={displayMeta.title}
      variant={'outlined'}
    />
  );
});

export default AssigneeAvatar;
