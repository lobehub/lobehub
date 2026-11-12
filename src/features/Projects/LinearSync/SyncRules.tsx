'use client';

import type { LinearConnectionView, LinearSyncJobView, LinearSyncRuleView } from '@lobechat/types';
import {
  ActionIcon,
  confirmModal,
  type DropdownItem,
  Flexbox,
  Icon,
  SplitButton,
  Text,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useIsWorkspaceViewer } from '@/business/client/hooks/useIsWorkspaceViewer';
import AsyncError from '@/components/AsyncError';
import { linearKeys } from '@/features/Integrations/Linear/swrKeys';
import { linearService } from '@/services/linear';

import {
  formatLinearSyncResult,
  isActiveLinearSyncJob,
  linearScopeProjectLabel,
  linearSyncErrorMessage,
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
    paddingBlock: 12,
    paddingInline: 16,
  },
  rowDivider: {
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
  },
});

export const useLinearSyncRules = (projectId: string | null) =>
  useSWR(projectId ? linearKeys.syncRules(projectId) : null, () =>
    linearService.listSyncRules(projectId!),
  );

interface SyncRulesProps {
  connections: LinearConnectionView[];
  /** The project's background syncs, to show which rule is running. */
  jobs: LinearSyncJobView[];
  onJobStarted: () => void;
  projectId: string;
}

/**
 * The project's saved sync rules: re-run one in the background, or remove
 * it. Running never writes to Linear.
 */
const SyncRules = memo<SyncRulesProps>(({ connections, jobs, onJobStarted, projectId }) => {
  const { t } = useTranslation('integration');
  const { data, error, isValidating, mutate } = useLinearSyncRules(projectId);
  const rules = data ?? [];
  // Viewers can see the rules but not run or remove them.
  const isViewer = useIsWorkspaceViewer();
  const viewerHint = isViewer ? t('linear.sync.viewerDisabled') : undefined;
  const [starting, setStarting] = useState<string | null>(null);
  // Tucked into each rule's sync menu; applies to the next run of any rule, and
  // re-running with it on fills in the comments already-synced tasks lack.
  const [syncComments, setSyncComments] = useState(true);
  // Likewise for labels: a run also labels the tasks it reads that were synced without them.
  const [syncLabels, setSyncLabels] = useState(true);
  // Off by default, as in Linear; on, a run also reaches the rule's archived issues.
  const [includeArchived, setIncludeArchived] = useState(false);
  const optionItems: DropdownItem[] = [
    {
      children: [
        {
          checked: syncComments,
          closeOnClick: false,
          desc: t('linear.sync.options.syncCommentsRuleDesc'),
          key: 'syncComments',
          label: t('linear.sync.options.syncComments'),
          onCheckedChange: setSyncComments,
          type: 'checkbox',
        },
        {
          checked: syncLabels,
          closeOnClick: false,
          desc: t('linear.sync.options.syncLabelsRuleDesc'),
          key: 'syncLabels',
          label: t('linear.sync.options.syncLabels'),
          onCheckedChange: setSyncLabels,
          type: 'checkbox',
        },
        {
          checked: includeArchived,
          closeOnClick: false,
          desc: t('linear.sync.options.includeArchivedRuleDesc'),
          key: 'includeArchived',
          label: t('linear.sync.options.includeArchived'),
          onCheckedChange: setIncludeArchived,
          type: 'checkbox',
        },
      ],
      key: 'options',
      label: t('linear.sync.options.syncTitle'),
      type: 'group',
    },
  ];
  const runningRuleIds = new Set(
    jobs.filter(isActiveLinearSyncJob).flatMap((job) => (job.ruleId ? [job.ruleId] : [])),
  );

  if (error && !data) {
    return (
      <AsyncError
        error={error}
        retrying={isValidating}
        title={t('linear.sync.rules.loadFailed')}
        variant={'block'}
        onRetry={() => void mutate()}
      />
    );
  }
  if (rules.length === 0) return null;

  const organizationOf = (rule: LinearSyncRuleView) =>
    connections.find((connection) => connection.id === rule.connectionId)?.organizationName;

  const runRule = async (rule: LinearSyncRuleView) => {
    setStarting(rule.id);
    try {
      await linearService.startRuleSync(rule.id, { includeArchived, syncComments, syncLabels });
      onJobStarted();
    } catch (error) {
      toast.error(linearSyncErrorMessage(error, t));
    } finally {
      setStarting(null);
    }
  };

  const deleteRule = (rule: LinearSyncRuleView) =>
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('linear.sync.rules.deleteContent'),
      okButtonProps: { danger: true },
      okText: t('linear.sync.rules.delete'),
      onOk: async () => {
        try {
          await linearService.deleteSyncRule(rule.id);
          void mutate();
        } catch {
          toast.error(t('linear.sync.error.generic'));
        }
      },
      title: t('linear.sync.rules.deleteTitle'),
    });

  return (
    <Flexbox gap={8}>
      <Text type={'secondary'}>{t('linear.sync.rules.title')}</Text>
      <div {...stylex.props(styles.list)}>
        {rules.map((rule, index) => {
          // A disconnected workspace's rule can still be deleted, not run.
          const disconnected = !organizationOf(rule);
          const running = starting === rule.id || runningRuleIds.has(rule.id);
          return (
            <Flexbox
              horizontal
              align={'center'}
              gap={12}
              key={rule.id}
              {...stylex.props(styles.row, index > 0 && styles.rowDivider)}
            >
              <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
                <Text ellipsis weight={500}>
                  {[organizationOf(rule), rule.teamName, linearScopeProjectLabel(rule, t)]
                    .filter(Boolean)
                    .join(' › ')}
                </Text>
                <Text ellipsis fontSize={12} type={'secondary'}>
                  {[
                    (rule.stateTypes ?? [])
                      .map((type) => t(`linear.sync.state.${type}`))
                      .join('、'),
                    rule.lastRunAt
                      ? t('linear.sync.rules.lastRun', {
                          result: rule.lastResult ? formatLinearSyncResult(rule.lastResult, t) : '',
                          time: new Date(rule.lastRunAt).toLocaleString(),
                        })
                      : t('linear.sync.rules.neverRun'),
                  ].join(' · ')}
                </Text>
              </Flexbox>
              {/* Only the main half spins while running; the options half just
                  turns disabled (SplitButton-level `loading` spins both halves). */}
              <SplitButton disabled={isViewer || disconnected} size={'small'}>
                <SplitButton.Main
                  icon={<Icon icon={RefreshCwIcon} />}
                  loading={running}
                  title={
                    viewerHint ?? (disconnected ? t('linear.sync.rules.disconnected') : undefined)
                  }
                  onClick={() => runRule(rule)}
                >
                  {runningRuleIds.has(rule.id)
                    ? t('linear.sync.rules.running')
                    : t('linear.sync.rules.run')}
                </SplitButton.Main>
                <SplitButton.Menu
                  disabled={running}
                  items={optionItems}
                  placement={'bottomRight'}
                />
              </SplitButton>
              <ActionIcon
                disabled={isViewer || runningRuleIds.has(rule.id)}
                icon={Trash2Icon}
                size={'small'}
                title={viewerHint ?? t('linear.sync.rules.delete')}
                onClick={() => deleteRule(rule)}
              />
            </Flexbox>
          );
        })}
      </div>
    </Flexbox>
  );
});

SyncRules.displayName = 'LinearSyncRules';

export default SyncRules;
