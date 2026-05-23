'use client';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { ArrowLeft, X } from 'lucide-react';
import { Fragment, memo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { SESSION_CHAT_TOPIC_PAGE_URL, SESSION_CHAT_TOPIC_URL } from '@/const/url';
import NavHeader from '@/features/NavHeader';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import TabStrip from './TabStrip';

const Header = memo(() => {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ aid?: string; topicId?: string }>();
  const [canGoBack, goBack, clearPortalStack] = useChatStore((s) => [
    chatPortalSelectors.canGoBack(s),
    s.goBack,
    s.clearPortalStack,
  ]);
  const isTopicPageRoute =
    !!params.aid &&
    !!params.topicId &&
    location.pathname.startsWith(SESSION_CHAT_TOPIC_PAGE_URL(params.aid, params.topicId));

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
          <ActionIcon
            icon={X}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            onClick={() => {
              if (params.aid && params.topicId && isTopicPageRoute) {
                navigate(SESSION_CHAT_TOPIC_URL(params.aid, params.topicId));
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
