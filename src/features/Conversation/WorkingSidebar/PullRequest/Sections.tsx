import type {
  DeviceGitPullRequestAction,
  DeviceGitPullRequestActivity,
  DeviceGitPullRequestDetail,
} from '@lobechat/types';
import { Flexbox, Icon, Markdown } from '@lobehub/ui';
import { Button, Skeleton } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderOpenIcon,
  GitCommitHorizontalIcon,
} from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SWRResponse } from 'swr';

import { ChevronRight, OverviewRow, rowStyles } from '../Overview/OverviewRow';
import { sectionStyles } from '../Overview/sectionStyles';
import ActivityTimeline from './ActivityTimeline';
import ChecksList from './ChecksList';
import { timeAgo } from './prVisual';
import type { PullRequestBusy } from './usePullRequestActions';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    overflow: hidden;

    min-width: 0;
    padding-block: 2px 6px;
    padding-inline: 8px;

    overflow-wrap: anywhere;

    table {
      overflow-x: auto;
      display: block;
      max-width: 100%;
    }

    img,
    video {
      max-width: 100%;
    }

    pre {
      overflow-x: auto;
      max-width: 100%;
    }
  `,
  header: css`
    cursor: pointer;
    user-select: none;
    gap: 6px;
  `,
  sha: css`
    font-family: ${cssVar.fontFamilyCode};
  `,
}));

interface SectionProps {
  children: ReactNode;
  count?: ReactNode;
  onToggle?: () => void;
  open?: boolean;
  title: string;
}

const Section = memo<SectionProps>(({ children, count, onToggle, open = true, title }) => (
  <Flexbox className={sectionStyles.section}>
    <Flexbox
      horizontal
      align={'center'}
      role={onToggle ? 'button' : undefined}
      className={cx(
        sectionStyles.sectionHeader,
        sectionStyles.sectionTitle,
        onToggle && styles.header,
      )}
      onClick={onToggle}
    >
      {onToggle && <Icon icon={open ? ChevronDownIcon : ChevronRightIcon} size={12} />}
      {title}
      {count !== undefined && <span className={sectionStyles.count}>{count}</span>}
    </Flexbox>
    {open && children}
  </Flexbox>
));

Section.displayName = 'PullRequestSection';

interface SectionsProps {
  activity: Pick<
    SWRResponse<DeviceGitPullRequestActivity>,
    'data' | 'error' | 'isValidating' | 'mutate'
  >;
  busy?: PullRequestBusy;
  detail: DeviceGitPullRequestDetail;
  onAction: (action: DeviceGitPullRequestAction) => Promise<boolean>;
  onOpenTab: (tab: string) => void;
}

const Sections = memo<SectionsProps>(({ activity, busy, detail, onAction, onOpenTab }) => {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const activityPlaceholder = activity.error ? (
    <Flexbox gap={8}>
      <span>{t('workingPanel.pr.error.load')}</span>
      <Button loading={activity.isValidating} size={'small'} onClick={() => void activity.mutate()}>
        {tCommon('retry')}
      </Button>
    </Flexbox>
  ) : (
    <Skeleton.Text rows={3} />
  );
  const [open, setOpen] = useState({
    activity: true,
    checks: false,
    commits: false,
    description: true,
  });
  const toggle = (key: keyof typeof open) => () => setOpen((o) => ({ ...o, [key]: !o[key] }));

  const failing = detail.checks.filter(
    (check) => check.status === 'failure' || check.status === 'cancelled',
  ).length;
  const running = detail.checks.filter((check) => check.status === 'pending').length;
  const checksCount = failing ? (
    <span style={{ color: cssVar.colorError }}>
      {t('workingPanel.pr.checks.failing', { count: failing })}
    </span>
  ) : running ? (
    <span style={{ color: cssVar.colorWarning }}>
      {t('workingPanel.pr.checks.running', { count: running })}
    </span>
  ) : (
    detail.checks.length
  );

  return (
    <>
      {detail.body && (
        <Section
          open={open.description}
          title={t('workingPanel.pr.section.description')}
          onToggle={toggle('description')}
        >
          <Markdown className={styles.body} fontSize={13} variant={'chat'}>
            {detail.body}
          </Markdown>
        </Section>
      )}
      <Section count={detail.changedFiles} title={t('workingPanel.pr.section.files')}>
        <OverviewRow
          icon={FolderOpenIcon}
          value={t('workingPanel.pr.files.openReview')}
          trailing={
            <>
              <span className={rowStyles.changeAdditions}>+{detail.additions}</span>
              <span className={rowStyles.changeDeletions}>−{detail.deletions}</span>
              <ChevronRight />
            </>
          }
          onClick={() => onOpenTab('review')}
        />
      </Section>
      {detail.checks.length > 0 && (
        <Section
          count={checksCount}
          open={open.checks}
          title={t('workingPanel.pr.section.checks')}
          onToggle={toggle('checks')}
        >
          <ChecksList checks={detail.checks} />
        </Section>
      )}
      <Section
        count={activity.data ? detail.commits.length : undefined}
        open={open.commits}
        title={t('workingPanel.pr.section.commits')}
        onToggle={toggle('commits')}
      >
        {!activity.data
          ? activityPlaceholder
          : detail.commits.map((commit) => (
              <OverviewRow
                weak
                icon={GitCommitHorizontalIcon}
                key={commit.sha}
                title={commit.message}
                value={commit.message.split('\n')[0]}
                trailing={
                  <>
                    <span className={styles.sha}>{commit.sha.slice(0, 7)}</span>
                    {timeAgo(commit.committedAt)}
                  </>
                }
              />
            ))}
      </Section>
      <Section
        count={activity.data ? detail.comments.length + detail.reviews.length : undefined}
        open={open.activity}
        title={t('workingPanel.pr.section.activity')}
        onToggle={toggle('activity')}
      >
        {activity.data ? (
          <ActivityTimeline busy={busy} detail={detail} onAction={onAction} />
        ) : (
          activityPlaceholder
        )}
      </Section>
    </>
  );
});

Sections.displayName = 'PullRequestSections';

export default Sections;
