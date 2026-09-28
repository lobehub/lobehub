'use client';

import {
  AGENT_CHAT_TOPIC_PAGE_URL,
  AGENT_CHAT_TOPIC_URL,
  DESKTOP_HEADER_ICON_SMALL_SIZE,
} from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { ArrowLeft, X } from 'lucide-react';
import { type CSSProperties, Fragment, type ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router';

import NavHeader from '@/features/NavHeader';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import { PortalMoreMenuSlot } from './PortalMoreMenu/context';

const Header = memo<{
  onClose?: () => void;
  paddingInline?: number;
  rightExtra?: ReactNode;
  /** Overrides the default block/inline padding, e.g. for a full-height tab strip. */
  style?: CSSProperties;
  title: ReactNode;
}>(({ onClose, paddingInline = 8, rightExtra, style, title }) => {
  const { t } = useTranslation('common');
  const location = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  const params = useParams<{ aid?: string; topicId?: string }>();
  const [canGoBack, goBack, clearPortalStack] = useChatStore((s) => [
    chatPortalSelectors.canGoBack(s),
    s.goBack,
    s.clearPortalStack,
  ]);
  const isTopicPageRoute =
    !!params.aid &&
    !!params.topicId &&
    location.pathname.startsWith(AGENT_CHAT_TOPIC_PAGE_URL(params.aid, params.topicId));

  return (
    <NavHeader
      showTogglePanelButton={false}
      style={{ paddingBlock: 8, paddingInline, width: '100%', ...style }}
      left={
        <Flexbox horizontal align="center" flex={1} gap={4} style={{ minWidth: 0 }}>
          {canGoBack && (
            <ActionIcon
              aria-label={t('back')}
              icon={ArrowLeft}
              size={DESKTOP_HEADER_ICON_SMALL_SIZE}
              title={t('back')}
              onClick={goBack}
            />
          )}
          {title}
          {/* The `…` belongs to the thing the title names, not to the panel
              chrome on the far edge, so it rides right behind the title. */}
          <PortalMoreMenuSlot />
        </Flexbox>
      }
      right={
        <Fragment>
          {rightExtra}
          <ActionIcon
            aria-label={t('close')}
            icon={X}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('close')}
            onClick={() => {
              if (onClose) {
                onClose();
                return;
              }

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
          marginLeft: canGoBack || paddingInline !== 8 ? 0 : 6,
          minWidth: 0,
        },
        right: {
          flex: 'none',
        },
      }}
    />
  );
});

export default Header;
