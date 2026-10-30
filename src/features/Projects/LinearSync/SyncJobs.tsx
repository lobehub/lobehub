'use client';

import type { LinearSyncJobView, LinearSyncRuleView } from '@lobechat/types';
import { Flexbox, Icon, Spin, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatLinearSyncResult, isActiveLinearSyncJob, linearSyncJobErrorMessage } from './utils';

const styles = stylex.create({
  list: {
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    minHeight: 44,
    paddingBlock: 10,
    paddingInline: 16,
  },
  rowDivider: {
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
  },
  status: {
    flexShrink: 0,
    width: 16,
  },
});

interface SyncJobsProps {
  jobs: LinearSyncJobView[];
  rules: LinearSyncRuleView[];
}

/** The project's recent background syncs: running ones first in time, then their outcomes. */
const SyncJobs = memo<SyncJobsProps>(({ jobs, rules }) => {
  const { t } = useTranslation('integration');
  if (jobs.length === 0) return null;

  const titleOf = (job: LinearSyncJobView) => {
    if (job.kind === 'issues')
      return t('linear.sync.job.titleIssues', { count: job.issueCount ?? 0 });
    const rule = rules.find((item) => item.id === job.ruleId);
    return rule
      ? t('linear.sync.job.titleRule', {
          rule: [rule.teamName, rule.linearProjectName].filter(Boolean).join(' › '),
        })
      : t('linear.sync.job.titleRuleDeleted');
  };

  const detailOf = (job: LinearSyncJobView) => {
    if (isActiveLinearSyncJob(job)) return t('linear.sync.job.inProgress');
    if (job.status === 'error') return linearSyncJobErrorMessage(job.error, t);
    return job.result ? formatLinearSyncResult(job.result, t) : '';
  };

  return (
    <Flexbox gap={8}>
      <Text type={'secondary'}>{t('linear.sync.job.listTitle')}</Text>
      <div {...stylex.props(styles.list)}>
        {jobs.map((job, index) => (
          <Flexbox
            horizontal
            align={'center'}
            gap={12}
            key={job.id}
            {...stylex.props(styles.row, index > 0 && styles.rowDivider)}
          >
            <Flexbox align={'center'} {...stylex.props(styles.status)}>
              {isActiveLinearSyncJob(job) ? (
                <Spin size={'small'} />
              ) : job.status === 'error' ? (
                <Icon color={cssVar.colorError} icon={CircleAlertIcon} size={16} />
              ) : (
                <Icon color={cssVar.colorSuccess} icon={CircleCheckIcon} size={16} />
              )}
            </Flexbox>
            <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
              <Text ellipsis>{titleOf(job)}</Text>
              <Text ellipsis fontSize={12} type={job.status === 'error' ? 'danger' : 'secondary'}>
                {detailOf(job)}
              </Text>
            </Flexbox>
            <Text fontSize={12} style={{ flexShrink: 0 }} type={'secondary'}>
              {new Date(job.createdAt).toLocaleString()}
            </Text>
          </Flexbox>
        ))}
      </div>
    </Flexbox>
  );
});

SyncJobs.displayName = 'LinearSyncJobs';

export default SyncJobs;
