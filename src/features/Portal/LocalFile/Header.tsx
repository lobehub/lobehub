'use client';

import { isDesktop } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { FolderOpen } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import PortalHeader from '@/features/Portal/components/Header';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useHeaderActionSize } from '@/styles/density';

import TabStrip from './TabStrip';

const Header = memo<{ onClose?: () => void }>(({ onClose }) => {
  const headerActionSize = useHeaderActionSize(true);
  const { t } = useTranslation('chat');
  const activeLocalFilePath = useChatStore(chatPortalSelectors.activeLocalFilePath);
  // Remote device and sandbox paths cannot be revealed in the local filesystem.
  const isRemoteFile = useChatStore(chatPortalSelectors.isCurrentLocalFileRemote);
  const canGoBack = useChatStore(chatPortalSelectors.canGoBack);
  const handleOpenFileFolder = useCallback(() => {
    if (!activeLocalFilePath) return;

    void localFileService.openFileFolder(activeLocalFilePath);
  }, [activeLocalFilePath]);

  return (
    <PortalHeader
      // The tab strip runs the full header height and starts at the edge: it
      // carries its own 8px start inset inside the scroll area, so tabs that
      // overflow scroll out under the panel edge instead of being clipped 8px
      // in. The back arrow sits outside the scroll area, so when it shows the
      // header pads the left like the right, as every other Portal header does.
      paddingInline={0}
      style={{ padding: canGoBack ? '0 8px' : '0 8px 0 0' }}
      title={<TabStrip />}
      rightExtra={
        isDesktop &&
        activeLocalFilePath &&
        !isRemoteFile && (
          <ActionIcon
            aria-label={t('workingPanel.files.showInSystem')}
            icon={FolderOpen}
            size={headerActionSize}
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
