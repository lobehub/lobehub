'use client';

import { DEFAULT_INBOX_AVATAR, DEFAULT_INBOX_TITLE } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';
import { Avatar, Spin } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type CSSProperties } from 'react';
import { memo } from 'react';

import { resolveInboxAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import NavItem from '@/features/NavPanel/components/NavItem';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { usePrefetchAgent } from '@/hooks/usePrefetchAgent';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import { usePreservedAgentUrl } from './usePreservedAgentUrl';

const styles = stylex.create({
  runningBadge: {
    pointerEvents: 'none',
    position: 'absolute',
    insetBlockEnd: '-3px',
    insetInlineEnd: '-3px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '14px',
    height: '14px',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBgContainer,
    borderRadius: '999px',
    color: cssVar.colorWarning,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  wrapper: { position: 'relative', display: 'inline-flex' },
});

interface InboxItemProps {
  className?: string;
  style?: CSSProperties;
}

const InboxItem = memo<InboxItemProps>(({ className, style }) => {
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const inboxRouteAgentId = resolveInboxAgentRouteId(inboxAgentId);
  const inboxMeta = useAgentStore(agentSelectors.getAgentMetaById(inboxRouteAgentId));

  const isLoading = useChatStore(
    inboxAgentId ? operationSelectors.isAgentVisiblyRunning(inboxAgentId) : () => false,
  );
  const prefetchAgent = usePrefetchAgent();
  const inboxAgentTitle = agentDisplayName(inboxMeta, DEFAULT_INBOX_TITLE);
  const inboxAgentAvatar = inboxMeta.avatar || DEFAULT_INBOX_AVATAR;
  const inboxUrl = usePreservedAgentUrl(inboxRouteAgentId);

  // Prefetch agent layout chunk and data eagerly since Lobe AI is almost always clicked
  if (inboxAgentId) prefetchAgent(inboxAgentId);

  const avatarNode = (
    <Avatar emojiScaleWithBackground avatar={inboxAgentAvatar} shape={'square'} size={24} />
  );

  return (
    <WorkspaceLink aria-label={inboxAgentTitle} to={inboxUrl}>
      <NavItem
        className={className}
        style={style}
        title={inboxAgentTitle}
        icon={
          isLoading ? (
            <span {...stylex.props(styles.wrapper)}>
              {avatarNode}
              <span {...stylex.props(styles.runningBadge)}>
                <Spin size={9} style={{ color: 'inherit' }} />
              </span>
            </span>
          ) : (
            avatarNode
          )
        }
      />
    </WorkspaceLink>
  );
});

export default InboxItem;
