import { Center, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Bot, CircleDashed, UserRound } from 'lucide-react';
import { memo } from 'react';

interface UnassignedAssigneeIconProps {
  kind: 'agent' | 'human';
  size?: number;
}

export const UnassignedAssigneeIcon = memo<UnassignedAssigneeIconProps>(({ kind, size = 18 }) => (
  <Center
    aria-hidden
    height={size}
    width={size}
    style={{
      color: cssVar.colorTextDescription,
      flexShrink: 0,
      position: 'relative',
    }}
  >
    <Icon icon={CircleDashed} size={{ size, strokeWidth: 1.5 }} />
    <Icon
      icon={kind === 'agent' ? Bot : UserRound}
      size={Math.max(8, Math.round(size * 0.64))}
      style={{ position: 'absolute' }}
    />
  </Center>
));
