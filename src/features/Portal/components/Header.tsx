'use client';

import { DESKTOP_HEADER_ICON_SIZE } from '@lobechat/const';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { ArrowLeft, PanelRightCloseIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Header = memo<{ title: ReactNode }>(({ title }) => {
  const [canGoBack, goBack, clearPortalStack] = useChatStore((s) => [
    chatPortalSelectors.canGoBack(s),
    s.goBack,
    s.clearPortalStack,
  ]);

  return (
    <NavHeader
      showTogglePanelButton={false}
      style={{ paddingBlock: 8, paddingInline: 8 }}
      left={
        <Flexbox horizontal align="center" gap={4}>
          {canGoBack && (
            <ActionIcon icon={ArrowLeft} size={DESKTOP_HEADER_ICON_SIZE} onClick={goBack} />
          )}
          {title}
        </Flexbox>
      }
      right={
        <ActionIcon
          icon={PanelRightCloseIcon}
          size={DESKTOP_HEADER_ICON_SIZE}
          onClick={() => {
            clearPortalStack();
          }}
        />
      }
      styles={{
        left: {
          marginLeft: canGoBack ? 0 : 6,
        },
      }}
    />
  );
});

export default Header;
