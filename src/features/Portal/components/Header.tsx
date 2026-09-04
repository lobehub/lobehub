'use client';

import {
  AGENT_CHAT_TOPIC_PAGE_URL,
  AGENT_CHAT_TOPIC_URL,
  DESKTOP_HEADER_ICON_SMALL_SIZE,
} from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { ArrowLeft, X } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useParams } from '@/libs/router/navigation';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { routerSelectors, useRouterStore } from '@/store/router';

const Header = memo<{
  paddingInline?: number;
  rightExtra?: ReactNode;
  title: ReactNode;
}>(({ paddingInline = 8, rightExtra, title }) => {
  const pathname = useRouterStore(routerSelectors.pathname);
  const navigate = useWorkspaceAwareNavigate();
  const params = useParams<{ aid?: string; topicId?: string }>('aid', 'topicId');
  const [canGoBack, goBack, clearPortalStack] = useChatStore((s) => [
    chatPortalSelectors.canGoBack(s),
    s.goBack,
    s.clearPortalStack,
  ]);
  const isTopicPageRoute =
    !!params.aid &&
    !!params.topicId &&
    pathname.startsWith(AGENT_CHAT_TOPIC_PAGE_URL(params.aid, params.topicId));

  return (
    <NavHeader
      showTogglePanelButton={false}
      style={{ paddingBlock: 8, paddingInline, width: '100%' }}
      left={
        <Flexbox horizontal align="center" flex={1} gap={4} style={{ minWidth: 0 }}>
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
