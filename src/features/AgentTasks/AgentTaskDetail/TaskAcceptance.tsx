'use client';

import { ActionIcon, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, RotateCcw } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import {
  type AcceptanceCheck,
  checkHeadMeta,
  groupChecks,
  shouldGroupChecks,
  useAcceptanceBundle,
  useAcceptanceBySubject,
} from '@/features/Verify';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { useGlobalStore } from '@/store/global';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

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
  list: css`
    overflow: hidden;
    padding: 0;
  `,
  row: css`
    cursor: pointer;
    padding-block: 10px;
    padding-inline: 12px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  seq: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
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
    <Flexbox
      horizontal
      align={'center'}
      className={styles.row}
      data-task-acceptance-check={check.id}
      gap={10}
      role={'button'}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onOpen();
      }}
    >
      <Icon color={meta.color} icon={meta.icon} size={16} style={{ flex: 'none' }} />
      <span className={styles.seq}>C{check.seq}</span>
      <Text ellipsis style={{ flex: 1, minWidth: 0 }}>
        {check.title}
      </Text>
    </Flexbox>
  );
});

CompactCheckRow.displayName = 'TaskAcceptanceCompactCheckRow';

const TaskAcceptance = memo(() => {
  const { t } = useTranslation(['chat', 'verify']);
  const openAcceptanceCheck = useChatStore((state) => state.openAcceptanceCheck);
  const currentPortalView = useChatStore(chatPortalSelectors.currentViewType);
  const showTaskAgentPanel = useGlobalStore((state) => state.toggleTaskAgentPanel);
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

  const header = (
    <TaskAcceptanceHeader
      count={checks.length}
      isOpen={sectionExpanded}
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
                <Block className={styles.list} variant={'outlined'}>
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
                                  onOpen={() => {
                                    if (currentPortalView !== PortalViewType.TaskDetail) {
                                      showTaskAgentPanel(true);
                                    }
                                    openAcceptanceCheck(bundle.acceptance.id, check.id);
                                  }}
                                />
                              ))}
                          </Flexbox>
                        );
                      })
                    : checks.map((check) => (
                        <CompactCheckRow
                          check={check}
                          key={check.id}
                          onOpen={() => {
                            if (currentPortalView !== PortalViewType.TaskDetail) {
                              showTaskAgentPanel(true);
                            }
                            openAcceptanceCheck(bundle.acceptance.id, check.id);
                          }}
                        />
                      ))}
                </Block>
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
