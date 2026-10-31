import type {
  DeviceGitPullRequestAction,
  DeviceGitPullRequestActivity,
  DeviceGitPullRequestDetail,
} from '@lobechat/types';
import { Button, cx, Flexbox, Icon, Markdown, Skeleton } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderOpenIcon,
  GitCommitHorizontalIcon,
} from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GitReplicaReadResult } from '@/store/device';

import { ChevronRight, OverviewRow, rowStyles } from '../Overview/OverviewRow';
import { sectionProps, sectionStyles } from '../Overview/sectionStyles';
import ActivityTimeline from './ActivityTimeline';
import ChecksList from './ChecksList';
import bodyStyles from './MarkdownBody.module.css';
import { timeAgo } from './prVisual';
import type { PullRequestBusy } from './usePullRequestActions';

const styles = stylex.create({
  body: {
    overflow: 'hidden',
    minWidth: 0,
    paddingBlockStart: '2px',
    paddingBlockEnd: '6px',
    paddingInline: '8px',
    overflowWrap: 'anywhere',
  },
  header: { cursor: 'pointer', userSelect: 'none', gap: '6px' },
  sha: { fontFamily: cssVar.fontFamilyCode },
});

interface SectionProps {
  children: ReactNode;
  count?: ReactNode;
  onToggle?: () => void;
  open?: boolean;
  title: string;
}

const Section = memo<SectionProps>(({ children, count, onToggle, open = true, title }) => (
  <Flexbox {...sectionProps()}>
    <Flexbox
      horizontal
      align={'center'}
      role={onToggle ? 'button' : undefined}
      {...stylex.props(
        sectionStyles.sectionHeader,
        sectionStyles.sectionTitle,
        onToggle && styles.header,
      )}
      onClick={onToggle}
    >
      {onToggle && <Icon icon={open ? ChevronDownIcon : ChevronRightIcon} size={12} />}
      {title}
      {count !== undefined && <span {...stylex.props(sectionStyles.count)}>{count}</span>}
    </Flexbox>
    {open && children}
  </Flexbox>
));

Section.displayName = 'PullRequestSection';

interface SectionsProps {
  actionsDisabled?: boolean;
  activity: Pick<
    GitReplicaReadResult<DeviceGitPullRequestActivity>,
    'data' | 'error' | 'isValidating' | 'mutate'
  >;
  busy?: PullRequestBusy;
  detail: DeviceGitPullRequestDetail;
  onAction: (action: DeviceGitPullRequestAction) => Promise<boolean>;
  onOpenTab: (tab: string) => void;
}

const Sections = memo<SectionsProps>(
  ({ actionsDisabled, activity, busy, detail, onAction, onOpenTab }) => {
    const { t } = useTranslation('chat');
    const { t: tCommon } = useTranslation('common');
    const activityPlaceholder = activity.error ? (
      <Flexbox gap={8}>
        <span>{t('workingPanel.pr.error.load')}</span>
        <Button loading={activity.isValidating} onClick={() => void activity.mutate()}>
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

    // Older devices (and persisted rows) may omit the list fields.
    const checks = detail.checks ?? [];
    const commits = detail.commits ?? [];
    const activityCount = (detail.comments?.length ?? 0) + (detail.reviews?.length ?? 0);
    const failing = checks.filter(
      (check) => check.status === 'failure' || check.status === 'cancelled',
    ).length;
    const running = checks.filter((check) => check.status === 'pending').length;
    const checksCount = failing ? (
      <span style={{ color: cssVar.colorError }}>
        {t('workingPanel.pr.checks.failing', { count: failing })}
      </span>
    ) : running ? (
      <span style={{ color: cssVar.colorWarning }}>
        {t('workingPanel.pr.checks.running', { count: running })}
      </span>
    ) : (
      checks.length
    );

    return (
      <>
        {detail.body && (
          <Section
            open={open.description}
            title={t('workingPanel.pr.section.description')}
            onToggle={toggle('description')}
          >
            <Markdown
              className={cx(stylex.props(styles.body).className, bodyStyles.body)}
              fontSize={13}
              variant={'chat'}
            >
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
                <span {...stylex.props(rowStyles.changeAdditions)}>+{detail.additions}</span>
                <span {...stylex.props(rowStyles.changeDeletions)}>−{detail.deletions}</span>
                <ChevronRight />
              </>
            }
            onClick={() => onOpenTab('review')}
          />
        </Section>
        {checks.length > 0 && (
          <Section
            count={checksCount}
            open={open.checks}
            title={t('workingPanel.pr.section.checks')}
            onToggle={toggle('checks')}
          >
            <ChecksList checks={checks} />
          </Section>
        )}
        <Section
          count={activity.data ? commits.length : undefined}
          open={open.commits}
          title={t('workingPanel.pr.section.commits')}
          onToggle={toggle('commits')}
        >
          {!activity.data
            ? activityPlaceholder
            : commits.map((commit) => (
                <OverviewRow
                  weak
                  icon={GitCommitHorizontalIcon}
                  key={commit.sha}
                  title={commit.message}
                  value={commit.message.split('\n')[0]}
                  trailing={
                    <>
                      <span {...stylex.props(styles.sha)}>{commit.sha.slice(0, 7)}</span>
                      {timeAgo(commit.committedAt)}
                    </>
                  }
                />
              ))}
        </Section>
        <Section
          count={activity.data ? activityCount : undefined}
          open={open.activity}
          title={t('workingPanel.pr.section.activity')}
          onToggle={toggle('activity')}
        >
          {activity.data ? (
            <ActivityTimeline
              actionsDisabled={actionsDisabled}
              busy={busy}
              detail={detail}
              onAction={onAction}
            />
          ) : (
            activityPlaceholder
          )}
        </Section>
      </>
    );
  },
);

Sections.displayName = 'PullRequestSections';

export default Sections;
