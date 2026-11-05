'use client';

import { ContextMenuTrigger, Flexbox, Spin } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type ComponentProps, memo, type MouseEvent, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { formatConversationTime, isPlainClick } from './conversations';
import { styles } from './style';

export interface ConversationRowProps {
  active?: boolean;
  activeAt?: Date;
  avatar: ReactNode;
  contextMenuItems?: ComponentProps<typeof ContextMenuTrigger>['items'];
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  onMouseEnter?: () => void;
  /** Pinned rows keep a tinted background, like WeChat's 置顶. */
  pinned?: boolean;
  preview?: string;
  /** The row element, e.g. the anchor for an inline rename popover. */
  ref?: Ref<HTMLElement>;
  running?: boolean;
  /** Title only, no preview line — for directory lists like the contacts tab. */
  singleLine?: boolean;
  title: string;
  unread?: number;
  url: string;
}

const ConversationRow = memo<ConversationRowProps>(
  ({
    active,
    activeAt,
    avatar,
    contextMenuItems,
    onClick,
    onMouseEnter,
    pinned,
    preview,
    ref,
    running,
    singleLine,
    title,
    unread,
    url,
  }) => {
    const { t } = useTranslation('common');
    const navigate = useWorkspaceAwareNavigate();
    // Clicking the open conversation again closes it, back to the Messages home with no row
    // selected. Modified clicks keep the link's own behavior.
    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      if (active && isPlainClick(event)) {
        event.preventDefault();
        navigate('/');
        return;
      }
      onClick?.(event);
    };

    const row = (
      <WorkspaceLink
        aria-current={active ? 'page' : undefined}
        aria-label={title}
        ref={ref}
        {...stylex.props(styles.row, pinned && styles.rowPinned, active && styles.rowActive)}
        to={url}
        onClick={handleClick}
        onMouseEnter={onMouseEnter}
      >
        <span {...stylex.props(styles.avatar)}>
          {avatar}
          {!!unread && unread > 0 && (
            <span {...stylex.props(styles.unread)}>{unread > 99 ? '99+' : unread}</span>
          )}
        </span>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'center'} gap={8}>
            <span {...stylex.props(styles.title)}>{title}</span>
            {activeAt && (
              <span {...stylex.props(styles.time)}>{formatConversationTime(activeAt)}</span>
            )}
          </Flexbox>
          {!singleLine && (
            <Flexbox horizontal align={'center'} gap={8}>
              {running ? (
                <Flexbox
                  horizontal
                  align={'center'}
                  {...stylex.props(styles.preview, styles.running)}
                  gap={4}
                >
                  <Spin size={10} style={{ color: 'inherit' }} />
                  {t('messageList.running')}
                </Flexbox>
              ) : (
                <span {...stylex.props(styles.preview)}>{preview || ' '}</span>
              )}
            </Flexbox>
          )}
        </Flexbox>
      </WorkspaceLink>
    );

    return contextMenuItems ? (
      <ContextMenuTrigger items={contextMenuItems}>{row}</ContextMenuTrigger>
    ) : (
      row
    );
  },
);

ConversationRow.displayName = 'ConversationRow';

export default ConversationRow;
