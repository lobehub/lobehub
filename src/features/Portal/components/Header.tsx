'use client';

import { DESKTOP_HEADER_ICON_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { PanelRightCloseIcon } from 'lucide-react';
import { type ReactNode, memo } from 'react';

import NavHeader from '@/features/NavHeader';
import { useChatStore } from '@/store/chat';

const Header = memo<{ title: ReactNode }>(({ title }) => {
  const [toggleInspector] = useChatStore((s) => [s.togglePortal]);

  return (
    <NavHeader
      left={title}
      right={
        <ActionIcon
          icon={PanelRightCloseIcon}
          onClick={() => {
            toggleInspector(false);
          }}
          size={DESKTOP_HEADER_ICON_SIZE}
        />
      }
      showTogglePanelButton={false}
      style={{ paddingBlock: 8, paddingInline: 8 }}
      styles={{
        left: {
          marginLeft: 6,
        },
      }}
    />
  );
});

export default Header;
