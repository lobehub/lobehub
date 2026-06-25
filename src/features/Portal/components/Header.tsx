'use client';

import {
  AGENT_CHAT_TOPIC_PAGE_URL,
  AGENT_CHAT_TOPIC_URL,
  DESKTOP_HEADER_ICON_SMALL_SIZE,
} from '@lobechat/const';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { ArrowLeft, X } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { memo } from 'react';
import { useLocation, useParams } from 'react-router';

import NavHeader from '@/features/NavHeader';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Header = memo<{ rightExtra?: ReactNode; title: ReactNode }>(({ title, rightExtra }) => {
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
      style={{ paddingBlock: 8, paddingInline: 8 }}
      left={
        <Flexbox horizontal align="center" gap={4}>
          {canGoBack && (
            <ActionIcon icon={ArrowLeft} size={DESKTOP_HEADER_ICON_SMALL_SIZE} onClick={goBack} />
          )}
          {title}
        </Flexbox>
      }
      right={
        <Fragment>
          {rightExtra}
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
          marginLeft: canGoBack ? 0 : 6,
        },
      }}
    />
  );
});

export default Header;
