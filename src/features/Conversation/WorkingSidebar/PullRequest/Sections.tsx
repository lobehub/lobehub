import type { DeviceGitPullRequestAction, DeviceGitPullRequestDetail } from '@lobechat/types';
import { Flexbox, Icon, Markdown } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderOpenIcon,
  GitCommitHorizontalIcon,
} from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChevronRight, OverviewRow, rowStyles } from '../Overview/OverviewRow';
import { sectionStyles } from '../Overview/sectionStyles';
import Activity from './Activity';
import ChecksList from './ChecksList';
import { timeAgo } from './prVisual';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    padding-block: 2px 6px;
    padding-inline: 8px;
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
  busy?: boolean;
  detail: DeviceGitPullRequestDetail;
  onAction: (action: DeviceGitPullRequestAction) => Promise<boolean>;
  onOpenTab: (tab: string) => void;
}

const Sections = memo<SectionsProps>(({ busy, detail, onAction, onOpenTab }) => {
  const { t } = useTranslation('chat');
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
        count={detail.commits.length}
        open={open.commits}
        title={t('workingPanel.pr.section.commits')}
        onToggle={toggle('commits')}
      >
        {detail.commits.map((commit) => (
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
        count={detail.comments.length + detail.reviews.length}
        open={open.activity}
        title={t('workingPanel.pr.section.activity')}
        onToggle={toggle('activity')}
      >
        <Activity busy={busy} detail={detail} onAction={onAction} />
      </Section>
    </>
  );
});

Sections.displayName = 'PullRequestSections';

export default Sections;
