import type { ChatTopicMetadata, DeviceGitPullRequestCiStatus } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { Clock } from 'lucide-react';
import {
  CircleAlert,
  CircleCheck,
  CircleSlash,
  CircleX,
  GitBranchIcon,
  GitForkIcon,
  LoaderCircle,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import DirIcon from '@/features/ChatInput/ControlBar/DirIcon';

import { getPullRequestState, getTopicMetaCard, PR_STATE_VISUAL } from './metaCardData';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    display: flex;
    flex-direction: column;
    gap: 8px;

    width: 300px;
    max-width: calc(100vw - 48px);
  `,
  header: css`
    display: flex;
    gap: 12px;
    align-items: baseline;
    justify-content: space-between;
  `,
  headerTime: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  headerTitle: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  row: css`
    display: flex;
    gap: 8px;
    align-items: center;

    min-width: 0;

    font-size: 13px;
    line-height: 18px;
    color: ${cssVar.colorTextSecondary};
  `,
  rowIcon: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};
  `,
  rowText: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  warnRow: css`
    align-items: flex-start;
    color: ${cssVar.colorWarning};
  `,
  warnIcon: css`
    flex: none;
    margin-block-start: 1px;
    color: ${cssVar.colorWarning};
  `,
  warnText: css`
    min-width: 0;
    line-height: 18px;
    white-space: normal;
  `,
  prLink: css`
    cursor: pointer;

    margin-inline: -6px;
    padding-block: 2px;
    padding-inline: 6px;
    border-radius: 6px;

    color: inherit;
    text-decoration: none;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

interface CiVisual {
  color: string;
  icon: typeof Clock;
  labelKey: string;
}

const getCiVisual = (status?: DeviceGitPullRequestCiStatus): CiVisual => {
  switch (status) {
    case 'success': {
      return { color: cssVar.colorSuccess, icon: CircleCheck, labelKey: 'metaCard.ci.success' };
    }
    case 'failure': {
      return { color: cssVar.colorError, icon: CircleX, labelKey: 'metaCard.ci.failure' };
    }
    case 'pending': {
      return { color: cssVar.colorWarning, icon: LoaderCircle, labelKey: 'metaCard.ci.pending' };
    }
    default: {
      return { color: cssVar.colorTextTertiary, icon: CircleSlash, labelKey: 'metaCard.ci.none' };
    }
  }
};

interface DetailRowProps {
  children: ReactNode;
  icon: typeof Clock;
  iconColor?: string;
  title?: string;
}

const DetailRow = memo<DetailRowProps>(({ icon, iconColor, title, children }) => (
  <div className={styles.row}>
    <Icon
      className={styles.rowIcon}
      icon={icon}
      size={15}
      style={iconColor ? { color: iconColor } : undefined}
    />
    <span className={styles.rowText} title={title}>
      {children}
    </span>
  </div>
));

DetailRow.displayName = 'DetailRow';

interface MetaHoverCardProps {
  metadata: ChatTopicMetadata | undefined;
  time?: ReactNode;
  title: string;
}

/**
 * Codex-style hover detail card for a topic row: surfaces the persisted repo /
 * branch / worktree / linked-PR / CI context on the right of the sidebar without
 * cluttering the row itself.
 */
const MetaHoverCard = memo<MetaHoverCardProps>(({ metadata, title, time }) => {
  const { t } = useTranslation('topic');
  const card = getTopicMetaCard(metadata);
  if (!card) return null;

  const { repoName, repoType, branch, detached, worktreeName, pullRequest } = card;
  const ci = pullRequest ? getCiVisual(pullRequest.ciStatus) : undefined;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>{title}</span>
        {time !== undefined && <span className={styles.headerTime}>{time}</span>}
      </div>

      {repoName && (
        <div className={styles.row}>
          <DirIcon repoType={repoType} size={15} />
          <span className={styles.rowText} title={repoName}>
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

      <div className={`${styles.row} ${styles.warnRow}`}>
        <Icon className={styles.warnIcon} icon={CircleAlert} size={15} />
        <span className={styles.warnText}>{t('metaCard.branchNote')}</span>
      </div>

      {pullRequest &&
        (() => {
          const prState = getPullRequestState(pullRequest);
          const prVisual = PR_STATE_VISUAL[prState];
          const prInner = (
            <>
              <Icon
                className={styles.rowIcon}
                icon={prVisual.icon}
                size={15}
                style={{ color: prVisual.color }}
              />
              <span className={styles.rowText} title={pullRequest.title}>
                <span style={{ color: prVisual.color, fontWeight: 500 }}>
                  {t(prVisual.labelKey)}
                </span>
                {pullRequest.title ? ` · ${pullRequest.title}` : ''}
                <span style={{ color: cssVar.colorTextTertiary }}>{` #${pullRequest.number}`}</span>
              </span>
            </>
          );
          // Clickable when a url is persisted — opens the PR on GitHub in the
          // system browser; older snapshots without a url stay a plain row.
          return pullRequest.url ? (
            <a
              className={`${styles.row} ${styles.prLink}`}
              href={pullRequest.url}
              rel={'noreferrer'}
              target={'_blank'}
            >
              {prInner}
            </a>
          ) : (
            <div className={styles.row}>{prInner}</div>
          );
        })()}

      {ci && (
        <DetailRow icon={ci.icon} iconColor={ci.color}>
          {t(ci.labelKey as 'metaCard.ci.none')}
        </DetailRow>
      )}
    </div>
  );
});

MetaHoverCard.displayName = 'MetaHoverCard';

export default MetaHoverCard;
