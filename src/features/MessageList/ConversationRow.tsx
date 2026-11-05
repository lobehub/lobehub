'use client';

import { ContextMenuTrigger, Flexbox, Spin } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type ComponentProps, memo, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { formatConversationTime } from './conversations';
import { styles } from './style';

export interface ConversationRowProps {
  active?: boolean;
  activeAt?: Date;
  avatar: ReactNode;
  contextMenuItems?: ComponentProps<typeof ContextMenuTrigger>['items'];
  onMouseEnter?: () => void;
  /** Pinned rows keep a tinted background, like WeChat's 置顶. */
  pinned?: boolean;
  preview?: string;
  /** The row element, e.g. the anchor for an inline rename popover. */
  ref?: Ref<HTMLElement>;
  running?: boolean;
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
    onMouseEnter,
    pinned,
    preview,
    ref,
    running,
    title,
    unread,
    url,
  }) => {
    const { t } = useTranslation('common');

    const row = (
      <WorkspaceLink
        aria-current={active ? 'page' : undefined}
        aria-label={title}
        ref={ref}
        {...stylex.props(styles.row, pinned && styles.rowPinned, active && styles.rowActive)}
        to={url}
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
