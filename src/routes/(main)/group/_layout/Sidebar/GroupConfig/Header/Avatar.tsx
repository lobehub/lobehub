'use client';

import { Block } from '@lobehub/ui';
import { memo } from 'react';

import { useOpenChatSettings } from '@/hooks/useInterceptingRoutes';
import SupervisorAvatar from '@/routes/(main)/group/features/GroupAvatar';

const HeaderAvatar = memo<{ size?: number }>(() => {
  const openChatSettings = useOpenChatSettings();

  return (
    <Block
      clickable
      flex={'none'}
      height={32}
      padding={2}
      variant={'borderless'}
      width={32}
      style={{
        overflow: 'hidden',
      }}
      onClick={(e) => {
        e.stopPropagation();
        openChatSettings();
      }}
    >
      <SupervisorAvatar size={28} />
    </Block>
  );
});

export default HeaderAvatar;
