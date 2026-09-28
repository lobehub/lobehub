'use client';

import { DESKTOP_HEADER_ICON_SMALL_SIZE, isDesktop } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { FolderOpen } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import PortalHeader from '@/features/Portal/components/Header';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import TabStrip from './TabStrip';

const Header = memo<{ onClose?: () => void }>(({ onClose }) => {
  const { t } = useTranslation('chat');
  const activeLocalFilePath = useChatStore(chatPortalSelectors.activeLocalFilePath);
  // Sandbox-backed tabs point at paths inside the cloud sandbox, not the local
  // filesystem — "show in system" would open an unrelated folder or fail.
  const isSandboxFile = useChatStore(
    (s) => !!chatPortalSelectors.currentLocalFile(s)?.sandboxTopicId,
  );
  const handleOpenFileFolder = useCallback(() => {
    if (!activeLocalFilePath) return;

    void localFileService.openFileFolder(activeLocalFilePath);
  }, [activeLocalFilePath]);

  return (
    <PortalHeader
      // The tab strip runs the full header height and starts at the edge.
      paddingInline={0}
      style={{ padding: '0 8px 0 0' }}
      title={<TabStrip />}
      rightExtra={
        isDesktop &&
        activeLocalFilePath &&
        !isSandboxFile && (
          <ActionIcon
            aria-label={t('workingPanel.files.showInSystem')}
            icon={FolderOpen}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('workingPanel.files.showInSystem')}
            onClick={handleOpenFileFolder}
          />
        )
      }
      onClose={onClose}
    />
  );
});

Header.displayName = 'LocalFileHeader';

export default Header;
