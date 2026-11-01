'use client';

import type { LinearSyncJobView, LinearSyncRuleView } from '@lobechat/types';
import { Button, Flexbox, Icon, Spin, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleAlertIcon, CircleCheckIcon, CircleStopIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { linearService } from '@/services/linear';

import {
  formatLinearSyncResult,
  isActiveLinearSyncJob,
  linearSyncJobErrorMessage,
  linearSyncJobProgress,
} from './utils';

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
  /** Viewers see the runs but cannot stop one. */
  canStop: boolean;
  jobs: LinearSyncJobView[];
  /** Called after a run was stopped, to reload the list. */
  onChanged: () => void;
  projectId: string;
  rules: LinearSyncRuleView[];
}

const isStopped = (job: LinearSyncJobView) => job.status === 'error' && job.error === 'canceled';

/** The project's recent background syncs: running ones first in time, then their outcomes. */
const SyncJobs = memo<SyncJobsProps>(({ canStop, jobs, onChanged, projectId, rules }) => {
  const { t } = useTranslation('integration');
  const [stopping, setStopping] = useState<string | null>(null);
  if (jobs.length === 0) return null;

  // A rule run can go on for many rounds; let the user end it after any of them.
  const stop = async (job: LinearSyncJobView) => {
    setStopping(job.id);
    try {
      await linearService.cancelSync(projectId, job.id);
      onChanged();
    } catch {
      toast.error(t('linear.sync.job.stopFailed'));
    } finally {
      setStopping(null);
    }
  };

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
    if (isActiveLinearSyncJob(job) && job.error === 'canceled') {
      return t('linear.sync.job.stopping');
    }
    if (isActiveLinearSyncJob(job)) return linearSyncJobProgress(job, t);
    if (isStopped(job) && job.result) {
      return `${linearSyncJobErrorMessage(job.error, t)} · ${formatLinearSyncResult(job.result, t)}`;
    }
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
              ) : isStopped(job) ? (
                <Icon color={cssVar.colorTextSecondary} icon={CircleStopIcon} size={16} />
              ) : job.status === 'error' ? (
                <Icon color={cssVar.colorError} icon={CircleAlertIcon} size={16} />
              ) : (
                <Icon color={cssVar.colorSuccess} icon={CircleCheckIcon} size={16} />
              )}
            </Flexbox>
            <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
              <Text ellipsis>{titleOf(job)}</Text>
              <Text
                ellipsis
                fontSize={12}
                type={job.status === 'error' && !isStopped(job) ? 'danger' : 'secondary'}
              >
                {detailOf(job)}
              </Text>
            </Flexbox>
            {/* Only a rule run goes on round after round; an import of picked
                issues is one round that cannot be cut short. */}
            {canStop &&
            job.kind === 'rule' &&
            isActiveLinearSyncJob(job) &&
            job.error !== 'canceled' ? (
              <Button
                icon={<Icon icon={CircleStopIcon} />}
                loading={stopping === job.id}
                size={'small'}
                onClick={() => stop(job)}
              >
                {t('linear.sync.job.stop')}
              </Button>
            ) : null}
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
