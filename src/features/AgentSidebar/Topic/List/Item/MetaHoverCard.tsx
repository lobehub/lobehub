import type { ChatTopicMetadata } from '@lobechat/types';
import { createStaticStyles, cssVar, Icon } from '@lobehub/ui';
import type { Clock } from 'lucide-react';
import { GitBranchIcon, GitForkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import DirIcon from '@/features/ChatInput/ControlBar/DirIcon';
import { densityVars } from '@/styles/densityVars';

import { getTopicMetaCard } from './metaCardData';

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
    gap: ${densityVars.contentGap};
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

    font-size: ${densityVars.fontSize};
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
}));

interface DetailRowProps {
  children: ReactNode;
  icon: typeof Clock;
  title?: string;
}

const DetailRow = memo<DetailRowProps>(({ icon, title, children }) => (
  <div className={styles.row}>
    <Icon className={styles.rowIcon} icon={icon} size={15} />
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
 * branch / worktree context on the right of the sidebar without cluttering the
 * row itself.
 */
const MetaHoverCard = memo<MetaHoverCardProps>(({ metadata, title, time }) => {
  const { t } = useTranslation('topic');
  const card = getTopicMetaCard(metadata);
  if (!card) return null;

  const { repoName, repoType, branch, detached, worktreeName } = card;

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
    </div>
  );
});

MetaHoverCard.displayName = 'MetaHoverCard';

export default MetaHoverCard;
