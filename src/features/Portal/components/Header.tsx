'use client';

import { DESKTOP_HEADER_ICON_SIZE } from '@lobechat/const';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { ArrowLeft, PanelRightCloseIcon } from 'lucide-react';
import { type ReactNode, memo } from 'react';

import NavHeader from '@/features/NavHeader';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Header = memo<{ title: ReactNode }>(({ title }) => {
  const [canGoBack, goBack, togglePortal] = useChatStore((s) => [
    chatPortalSelectors.canGoBack(s),
    s.goBack,
    s.togglePortal,
  ]);

  return (
    <NavHeader
      left={
        <Flexbox align="center" gap={4} horizontal>
          {canGoBack && (
            <ActionIcon icon={ArrowLeft} onClick={goBack} size={DESKTOP_HEADER_ICON_SIZE} />
          )}
          {title}
        </Flexbox>
      }
      right={
        <ActionIcon
          icon={PanelRightCloseIcon}
          onClick={() => {
            togglePortal(false);
          }}
          size={DESKTOP_HEADER_ICON_SIZE}
        />
      }
      showTogglePanelButton={false}
      style={{ paddingBlock: 8, paddingInline: 8 }}
      styles={{
        left: {
          marginLeft: canGoBack ? 0 : 6,
        },
      }}
    />
  );
});

export default Header;
