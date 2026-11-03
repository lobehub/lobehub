'use client';

import { Center } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { type CSSProperties, memo } from 'react';

interface SkillAvatarProps {
  className?: string;
  size?: number;
  style?: CSSProperties;
}

const SkillAvatar = memo<SkillAvatarProps>(({ size = 40, className, style }) => {
  return (
    <Center
      className={className}
      flex={'none'}
      style={{
        borderRadius: Math.floor(size * 0.1),
        color: '#000',
        height: size,
        overflow: 'hidden',
        width: size,
        ...style,
      }}
    >
      <SkillsIcon color={'#000'} size={size} style={{ transform: 'scale(0.75)' }} />
    </Center>
  );
});

SkillAvatar.displayName = 'SkillAvatar';

export default SkillAvatar;
