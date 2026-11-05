import type { ChatTopicMetadata } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { Clock } from 'lucide-react';
import { GitBranchIcon, GitForkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import DirIcon from '@/features/ChatInput/ControlBar/DirIcon';
import { useChatStore } from '@/store/chat';

import {
  getCiVisual,
  getPullRequestState,
  getTopicMetaCard,
  PR_STATE_VISUAL,
} from './metaCardData';

const styles = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '300px',
    maxWidth: 'calc(100vw - 48px)',
  },
  header: { display: 'flex', gap: '12px', alignItems: 'baseline', justifyContent: 'space-between' },
  headerTime: { flex: 'none', fontSize: '12px', color: cssVar.colorTextTertiary },
  headerTitle: {
    overflow: 'hidden',
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: '20px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  row: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    minWidth: '0',
    fontSize: '13px',
    lineHeight: '18px',
    color: cssVar.colorTextSecondary,
  },
  rowIcon: { flex: 'none', color: cssVar.colorTextTertiary },
  rowText: { overflow: 'hidden', minWidth: '0', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  prLink: {
    cursor: 'pointer',
    marginInline: '-6px',
    paddingBlock: '2px',
    paddingInline: '6px',
    borderRadius: '6px',
    color: { 'default': 'inherit', ':hover': cssVar.colorText },
    textDecoration: 'none',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});

interface DetailRowProps {
  children: ReactNode;
  icon: typeof Clock;
  iconColor?: string;
  title?: string;
}

const DetailRow = memo<DetailRowProps>(({ icon, iconColor, title, children }) => (
  <div {...stylex.props(styles.row)}>
    <Icon
      className={stylex.props(styles.rowIcon).className}
      icon={icon}
      size={15}
      style={iconColor ? { color: iconColor } : undefined}
    />
    <span {...stylex.props(styles.rowText)} title={title}>
      {children}
    </span>
  </div>
));

DetailRow.displayName = 'DetailRow';

interface MetaHoverCardProps {
  metadata: ChatTopicMetadata | undefined;
  time?: ReactNode;
  title: string;
  /** Enables the open-time PR/CI refresh below; without it the card is a pure snapshot reader. */
  topicId?: string;
}

/**
 * Codex-style hover detail card for a topic row: surfaces the persisted repo /
 * branch / worktree / linked-PR / CI context on the right of the sidebar without
 * cluttering the row itself.
 */
const MetaHoverCard = memo<MetaHoverCardProps>(({ metadata, title, time, topicId }) => {
  const { t } = useTranslation('topic');
  // The card only mounts while the popover is open, so hosting the linked-PR
  // SWR hook here re-fetches the persisted PR/CI snapshot exactly when the
  // user is looking at it (the hook dedupes to once a minute per PR).
  // ChatHydration runs the same hook for the active topic only — without this,
  // a background topic's badge stays frozen on whatever was last persisted.
  const useFetchTopicLinkedPullRequest = useChatStore((s) => s.useFetchTopicLinkedPullRequest);
  useFetchTopicLinkedPullRequest(topicId, metadata);

  const card = getTopicMetaCard(metadata);
  if (!card) return null;

  const { repoName, repoType, branch, detached, worktreeName, pullRequest } = card;
  const ci = pullRequest ? getCiVisual(pullRequest.ciStatus) : undefined;

  return (
    <div {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.headerTitle)}>{title}</span>
        {time !== undefined && <span {...stylex.props(styles.headerTime)}>{time}</span>}
      </div>

      {repoName && (
        <div {...stylex.props(styles.row)}>
          <DirIcon repoType={repoType} size={15} />
          <span {...stylex.props(styles.rowText)} title={repoName}>
            {repoName}
          </span>
        </div>
      )}

      {branch && (
        <DetailRow icon={GitBranchIcon} title={branch}>
          {detached ? t('metaCard.detached', { sha: branch }) : branch}
        </DetailRow>
      )}

      {worktreeName && (
        <DetailRow icon={GitForkIcon} title={worktreeName}>
          {worktreeName}
        </DetailRow>
      )}

      {pullRequest &&
        (() => {
          const prState = getPullRequestState(pullRequest);
          const prVisual = PR_STATE_VISUAL[prState];
          const prTitleAttr = pullRequest.title
            ? `#${pullRequest.number} ${pullRequest.title}`
            : `#${pullRequest.number}`;
          const prInner = (
            <>
              <Icon
                className={stylex.props(styles.rowIcon).className}
                icon={prVisual.icon}
                size={15}
                style={{ color: prVisual.color }}
              />
              <span {...stylex.props(styles.rowText)} title={prTitleAttr}>
                <span style={{ color: prVisual.color, fontWeight: 500 }}>
                  {t(prVisual.labelKey)}
                </span>
                {/* The number leads the title: it is the stable identifier, and a
                    long title would otherwise push it past the ellipsis. */}
                <span
                  style={{ color: cssVar.colorTextTertiary }}
                >{` · #${pullRequest.number}`}</span>
                {pullRequest.title ? ` ${pullRequest.title}` : ''}
              </span>
            </>
          );
          // Clickable when a url is persisted — opens the PR on GitHub in the
          // system browser; older snapshots without a url stay a plain row.
          return pullRequest.url ? (
            <a
              {...stylex.props(styles.row, styles.prLink)}
              href={pullRequest.url}
              rel={'noreferrer'}
              target={'_blank'}
            >
              {prInner}
            </a>
          ) : (
            <div {...stylex.props(styles.row)}>{prInner}</div>
          );
        })()}

      {ci && (
        <DetailRow icon={ci.icon} iconColor={ci.color}>
          {t(ci.labelKey)}
        </DetailRow>
      )}
    </div>
  );
});

MetaHoverCard.displayName = 'MetaHoverCard';

export default MetaHoverCard;
