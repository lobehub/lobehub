'use client';

import type { LinearSyncJobView, LinearSyncResult } from '@lobechat/types';
import { Center, Flexbox, Result, Spin, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  formatLinearSyncResult,
  isActiveLinearSyncJob,
  linearSyncJobErrorMessage,
  linearSyncSkippedCount,
} from './utils';

const styles = stylex.create({
  identifier: {
    color: cssVar.colorTextSecondary,
    flexShrink: 0,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
    width: 72,
  },
  skipped: {
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    maxHeight: 180,
    overflowY: 'auto',
  },
  skippedRow: {
    minHeight: 36,
    paddingBlock: 8,
    paddingInline: 12,
  },
  skippedRowDivider: {
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
  },
});

/** Issues the sync left alone, each with why. */
const SkippedList = ({
  skipped,
  total,
}: {
  skipped: NonNullable<LinearSyncResult['skipped']>;
  /** Every skipped issue; the list may stop short of it. */
  total: number;
}) => {
  const { t } = useTranslation('integration');
  return (
    <Flexbox gap={8}>
      <Text fontSize={12} type={'secondary'}>
        {t('linear.sync.job.skippedTitle', { count: total })}
      </Text>
      <div {...stylex.props(styles.skipped)}>
        {skipped.map((item, index) => (
          <Flexbox
            horizontal
            align={'center'}
            gap={12}
            key={item.identifier}
            {...stylex.props(styles.skippedRow, index > 0 && styles.skippedRowDivider)}
          >
            <span {...stylex.props(styles.identifier)}>{item.identifier}</span>
            <Text fontSize={13}>{t(`linear.sync.job.skipReason.${item.reason}`)}</Text>
          </Flexbox>
        ))}
      </div>
    </Flexbox>
  );
};

interface RunStepProps {
  /** The dialog's buttons for this state, centered under the result. */
  actions?: ReactNode;
  job: LinearSyncJobView | undefined;
  /** Issues the dialog asked to import, until the job itself has loaded; absent for a rule sync. */
  pendingIssueCount?: number;
}

/**
 * The sync this dialog started. It keeps running if the dialog is closed; the
 * outcome is then shown under the project's sync runs.
 */
const RunStep = memo<RunStepProps>(({ actions, job, pendingIssueCount }) => {
  const { t } = useTranslation('integration');

  if (!job || isActiveLinearSyncJob(job)) {
    const issueCount = job ? (job.kind === 'rule' ? undefined : job.issueCount) : pendingIssueCount;
    return (
      <Result
        extra={actions}
        subTitle={t('linear.sync.job.background')}
        icon={
          // As tall as the status badge that replaces it, so the result does not jump.
          <Center height={72} width={72}>
            <Spin size={'large'} />
          </Center>
        }
        title={
          issueCount
            ? t('linear.sync.job.runningIssues', { count: issueCount })
            : t('linear.sync.job.runningRule')
        }
      />
    );
  }

  if (job.status === 'error') {
    return (
      <Result
        extra={actions}
        status={'error'}
        subTitle={linearSyncJobErrorMessage(job.error, t)}
        title={t('linear.sync.job.failed')}
      />
    );
  }

  const result = job.result;
  // An older server may omit the list.
  const skipped = result?.skipped ?? [];
  const skippedTotal = result ? linearSyncSkippedCount(result) : 0;
  return (
    <Result
      extra={actions}
      status={'success'}
      subTitle={result ? formatLinearSyncResult(result, t) : undefined}
      title={t('linear.sync.job.done')}
    >
      {result && result.keptLocalEdits > 0 ? (
        <Text fontSize={12} type={'secondary'}>
          {t('linear.sync.job.keptLocalEdits', { count: result.keptLocalEdits })}
        </Text>
      ) : null}
      {skipped.length > 0 ? (
        <Flexbox style={{ alignSelf: 'stretch', textAlign: 'start' }}>
          <SkippedList skipped={skipped} total={skippedTotal} />
        </Flexbox>
      ) : null}
    </Result>
  );
});

RunStep.displayName = 'LinearImportRunStep';

export default RunStep;
