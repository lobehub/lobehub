'use client';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { Maximize2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import PortalChromeHeader from '@/features/Portal/components/Header';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import { getMemoryDetailPath } from './memoryDetailRoutes';
import Title from './Title';

const Header = memo<{ onClose?: () => void }>(({ onClose }) => {
  const { t } = useTranslation('chat');
  const view = useChatStore(chatPortalSelectors.memoryDetailView);
  const navigate = useWorkspaceAwareNavigate();
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);

  return (
    <PortalChromeHeader
      title={<Title />}
      rightExtra={
        view ? (
          <ActionIcon
            icon={Maximize2Icon}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('agentSignal.receipts.memory.openInMemory')}
            onClick={() => {
              navigate(getMemoryDetailPath(view.layer, view.id));
              clearPortalStack();
            }}
          />
        ) : undefined
      }
      onClose={onClose}
    />
  );
});

Header.displayName = 'MemoryDetailHeader';

export default Header;
