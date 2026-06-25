'use client';

import {
  AGENT_CHAT_TOPIC_PAGE_URL,
  AGENT_CHAT_TOPIC_URL,
  DESKTOP_HEADER_ICON_SMALL_SIZE,
  isDesktop,
} from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { ArrowLeft, FolderOpen, X } from 'lucide-react';
import { Fragment, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router';

import NavHeader from '@/features/NavHeader';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import TabStrip from './TabStrip';

const Header = memo(() => {
  const { t } = useTranslation('chat');
  const location = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  const params = useParams<{ aid?: string; topicId?: string }>();
  const activeLocalFilePath = useChatStore(chatPortalSelectors.activeLocalFilePath);
  const [canGoBack, goBack, clearPortalStack] = useChatStore((s) => [
    chatPortalSelectors.canGoBack(s),
    s.goBack,
    s.clearPortalStack,
  ]);
  const isTopicPageRoute =
    !!params.aid &&
    !!params.topicId &&
    location.pathname.startsWith(AGENT_CHAT_TOPIC_PAGE_URL(params.aid, params.topicId));
  const handleOpenFileFolder = useCallback(() => {
    if (!activeLocalFilePath) return;

    void localFileService.openFileFolder(activeLocalFilePath);
  }, [activeLocalFilePath]);

  return (
    <NavHeader
      showTogglePanelButton={false}
      style={{ padding: '0 8px 0 0' }}
      left={
        <Fragment>
          {canGoBack && (
            <ActionIcon icon={ArrowLeft} size={DESKTOP_HEADER_ICON_SMALL_SIZE} onClick={goBack} />
          )}
          <TabStrip />
        </Fragment>
      }
      right={
        <Fragment>
          {isDesktop && activeLocalFilePath && (
            <ActionIcon
              icon={FolderOpen}
              size={DESKTOP_HEADER_ICON_SMALL_SIZE}
              title={t('workingPanel.files.showInSystem')}
              onClick={handleOpenFileFolder}
            />
          )}
          <ActionIcon
            icon={X}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            onClick={() => {
              if (params.aid && params.topicId && isTopicPageRoute) {
                navigate(AGENT_CHAT_TOPIC_URL(params.aid, params.topicId));
                return;
              }

              clearPortalStack();
            }}
          />
        </Fragment>
      }
      styles={{
        left: {
          flex: 1,
          minWidth: 0,
        },
      }}
    />
  );
});

Header.displayName = 'LocalFileHeader';

export default Header;
