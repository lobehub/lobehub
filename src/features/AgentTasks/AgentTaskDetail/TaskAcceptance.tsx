'use client';

import { ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  RotateCcw,
  Trash,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import {
  type AcceptanceCheck,
  checkHeadMeta,
  CriterionList,
  CriterionRow,
  groupChecks,
  shouldGroupChecks,
  useAcceptanceBundle,
  useAcceptanceBySubject,
} from '@/features/Verify';
import { usePermission } from '@/hooks/usePermission';
import { verifyService } from '@/services/verify';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import GoalRoundTimeline from './GoalRoundTimeline';
import { resolveTaskAcceptanceRequirement } from './resolveTaskAcceptanceProjection';
import { TaskAcceptanceHeader } from './TaskAcceptanceHeader';
import TaskVerifyConfig from './TaskVerifyConfig';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    padding-inline: 12px;
  `,
  error: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorErrorBg};
  `,
  group: css`
    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  groupHeader: css`
    cursor: pointer;
    padding-block: 9px;
    padding-inline: 12px;
  `,
}));

interface AcceptanceErrorProps {
  onRetry: () => void;
}

const AcceptanceError = memo<AcceptanceErrorProps>(({ onRetry }) => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox horizontal align={'center'} className={styles.error} gap={8}>
      <Text fontSize={12} style={{ flex: 1 }} type={'danger'}>
        {t('taskDetail.acceptance.loadError')}
      </Text>
      <Button icon={<Icon icon={RotateCcw} />} size={'small'} type={'text'} onClick={onRetry}>
        {t('taskDetail.acceptance.retry')}
      </Button>
    </Flexbox>
  );
});

AcceptanceError.displayName = 'TaskAcceptanceError';

interface CompactCheckRowProps {
  check: AcceptanceCheck;
  onOpen: () => void;
}

const CompactCheckRow = memo<CompactCheckRowProps>(({ check, onOpen }) => {
  const meta = checkHeadMeta(check);

  return (
    <CriterionRow
      data-task-acceptance-check={check.id}
      icon={<Icon color={meta.color} icon={meta.icon} size={16} style={{ flex: 'none' }} />}
      seq={check.seq}
      title={check.title}
      onOpen={onOpen}
    />
  );
});

CompactCheckRow.displayName = 'TaskAcceptanceCompactCheckRow';

const TaskAcceptance = memo(() => {
  const { t } = useTranslation(['chat', 'verify']);
  const openAcceptance = useChatStore((state) => state.openAcceptance);
  const openAcceptanceCheck = useChatStore((state) => state.openAcceptanceCheck);
  const showTaskAgentPanel = useGlobalStore((state) => state.toggleTaskAgentPanel);
  const { allowed: canEditTask } = usePermission('create_content');
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const taskDatabaseId = useTaskStore(taskDetailSelectors.activeTaskDatabaseId);
  const verify = useTaskStore(taskDetailSelectors.activeTaskVerifyConfig);
  const [sectionExpanded, setSectionExpanded] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  const {
    data: acceptanceSubject,
    error: subjectError,
    isLoading: subjectLoading,
    mutate: mutateSubject,
  } = useAcceptanceBySubject('task', taskDatabaseId ?? null);
  const {
    data: bundle,
    error: bundleError,
    isLoading: bundleLoading,
    mutate: mutateBundle,
  } = useAcceptanceBundle(acceptanceSubject?.id ?? null);

  // Task detail intentionally renders the Acceptance's cross-round union. The
  // count may grow when later rounds introduce checks; that history is part of
  // the delivery record rather than a mismatch with the original configuration.
  const checks = useMemo(() => bundle?.checks ?? [], [bundle?.checks]);
  const requirement = resolveTaskAcceptanceRequirement(
    verify?.requirement,
    bundle?.acceptance.requirement,
  );
  const openCheck = (acceptanceId: string, checkId: string) => {
    showTaskAgentPanel(true);
    openAcceptanceCheck(acceptanceId, checkId);
  };

  // Same destination as a check, one level up: the report belongs in the panel
  // beside the task, not on a page that replaces it.
  const openReport = (acceptanceId: string) => {
    showTaskAgentPanel(true);
    openAcceptance(acceptanceId);
  };

  const grouped = shouldGroupChecks(checks.length);
  const groups = useMemo(
    () =>
      grouped ? groupChecks(checks, t('acceptance.group.uncategorized', { ns: 'verify' })) : [],
    [checks, grouped, t],
  );
  const groupKeys = groups.map((group) => group.key);
  const allGroupsCollapsed =
    groupKeys.length > 0 && groupKeys.every((key) => collapsedGroups.has(key));
  if (subjectLoading) return <NeuralNetworkLoading size={28} />;
  // Before the first Acceptance round exists, the configured criteria ARE the
  // delivery acceptance. Keep them in this single slot; once a round exists,
  // replace the definitions with their live/result projection below.
  if (!acceptanceSubject && !subjectError) return <TaskVerifyConfig />;

  // Removing the acceptance drops the aggregate (round reports detach) AND
  // clears the task's verify config — otherwise the section would fall back to
  // the configured-criteria view and the next run would recreate the aggregate.
  // Ordering makes the two writes safe without a server transaction: the config
  // is cleared FIRST (a failure aborts before anything is destroyed), and only
  // then is the aggregate deleted (a failure there leaves it intact for retry).
  // The inverse order could delete the record while the stale config survives
  // to recreate it on the next run.
  const handleRemoveAcceptance = () => {
    if (!acceptanceSubject || !taskId) return;
    confirmModal({
      content: t('taskDetail.acceptance.removeConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('taskDetail.acceptance.removeConfirm.ok'),
      onOk: async () => {
        await useTaskStore.getState().updateVerifyConfig(taskId, {
          enabled: false,
          requirement: null,
          verifyCriteriaIds: null,
        });
        await verifyService.deleteAcceptance(acceptanceSubject.id);
        await mutateSubject();
      },
      title: t('taskDetail.acceptance.removeConfirm.title'),
    });
  };

  // `acceptance.remove` only authorizes the acceptance creator (or a workspace
  // owner, cloud-side), not everyone who can edit the task — so the affordance
  // follows the bundle's isOwner rather than dead-ending in FORBIDDEN.
  const header = (
    <TaskAcceptanceHeader
      count={checks.length}
      // The section shows the rounds and the checklist; the report is the full
      // record behind them — reachable from the block it belongs to, instead
      // of only from the status row at the top of the page.
      isOpen={sectionExpanded}
      extra={
        acceptanceSubject && (
          <Flexbox horizontal align={'center'} gap={4}>
            <Button
              icon={<Icon icon={ExternalLink} />}
              size={'small'}
              type={'text'}
              onClick={() => openReport(acceptanceSubject.id)}
            >
              {t('taskDetail.acceptance.openReport')}
            </Button>
            {canEditTask && bundle?.isOwner && (
              <ActionIcon
                icon={Trash}
                size={'small'}
                title={t('taskDetail.acceptance.remove')}
                onClick={handleRemoveAcceptance}
              />
            )}
          </Flexbox>
        )
      }
      onToggle={() => setSectionExpanded((expanded) => !expanded)}
    />
  );

  if (subjectError) {
    return (
      <Flexbox gap={8}>
        {header}
        <Flexbox className={styles.body}>
          <AcceptanceError onRetry={() => void mutateSubject()} />
        </Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={8}>
      {header}
      {sectionExpanded && (
        <Flexbox className={styles.body} gap={14}>
          {bundleLoading && <NeuralNetworkLoading size={28} />}
          {bundleError && <AcceptanceError onRetry={() => void mutateBundle()} />}
          {bundle && (
            <>
              <GoalRoundTimeline rounds={bundle.rounds} />
              {requirement && (
                <Flexbox gap={6}>
                  <Text fontSize={12} type={'secondary'}>
                    {t('taskDetail.acceptance.goal')}
                  </Text>
                  <Text>{requirement}</Text>
                </Flexbox>
              )}
              <Flexbox gap={7}>
                <Flexbox horizontal align={'center'} gap={8}>
                  <Text fontSize={12} type={'secondary'}>
                    {t('taskDetail.acceptance.checklist')}
                  </Text>
                  <Flexbox flex={1} />
                  {grouped && groupKeys.length > 0 && (
                    <ActionIcon
                      icon={allGroupsCollapsed ? ChevronsUpDown : ChevronsDownUp}
                      size={'small'}
                      title={
                        allGroupsCollapsed
                          ? t('taskDetail.acceptance.expandAll')
                          : t('taskDetail.acceptance.collapseAll')
                      }
                      onClick={() =>
                        setCollapsedGroups(allGroupsCollapsed ? new Set() : new Set(groupKeys))
                      }
                    />
                  )}
                </Flexbox>
                <CriterionList>
                  {grouped
                    ? groups.map((group) => {
                        const collapsed = collapsedGroups.has(group.key);

                        return (
                          <Flexbox className={styles.group} key={group.key}>
                            <Flexbox
                              horizontal
                              align={'center'}
                              className={styles.groupHeader}
                              gap={8}
                              onClick={() =>
                                setCollapsedGroups((previous) => {
                                  const next = new Set(previous);
                                  if (next.has(group.key)) next.delete(group.key);
                                  else next.add(group.key);
                                  return next;
                                })
                              }
                            >
                              <Text fontSize={12}>{group.label}</Text>
                              <Text fontSize={11} type={'secondary'}>
                                {group.checks.length}
                              </Text>
                              <Flexbox flex={1} />
                              <Icon
                                color={cssVar.colorTextDescription}
                                icon={ChevronRight}
                                size={13}
                                style={{
                                  transform: collapsed ? 'none' : 'rotate(90deg)',
                                  transition: 'transform 0.2s',
                                }}
                              />
                            </Flexbox>
                            {!collapsed &&
                              group.checks.map((check) => (
                                <CompactCheckRow
                                  check={check}
                                  key={check.id}
                                  onOpen={() => openCheck(bundle.acceptance.id, check.id)}
                                />
                              ))}
                          </Flexbox>
                        );
                      })
                    : checks.map((check) => (
                        <CompactCheckRow
                          check={check}
                          key={check.id}
                          onOpen={() => openCheck(bundle.acceptance.id, check.id)}
                        />
                      ))}
                </CriterionList>
              </Flexbox>
            </>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});

TaskAcceptance.displayName = 'TaskAcceptance';

export default TaskAcceptance;
