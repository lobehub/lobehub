'use client';

import { DESKTOP_HEADER_ICON_SIZE } from '@lobechat/const';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { ArrowLeft, X } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { SESSION_CHAT_TOPIC_PAGE_URL, SESSION_CHAT_TOPIC_URL } from '@/const/url';
import NavHeader from '@/features/NavHeader';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Header = memo<{ title: ReactNode }>(({ title }) => {
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
          icon={X}
          size={DESKTOP_HEADER_ICON_SIZE}
          onClick={() => {
            if (params.aid && params.topicId && isTopicPageRoute) {
              navigate(SESSION_CHAT_TOPIC_URL(params.aid, params.topicId));
              return;
            }

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
