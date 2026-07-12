import type { TaskStatus, WorkListItem, WorkVersionItem } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { ActionIcon, Center, Empty, Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  FileTextIcon,
  HistoryIcon,
  ListIcon,
  Trash2Icon,
} from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { formatTaskItemDate } from '@/features/AgentTasks/features/formatTaskItemDate';
import LinearIcon from '@/features/AgentTasks/features/icons/LinearIcon';
import TaskPriorityTag from '@/features/AgentTasks/features/TaskPriorityTag';
import TaskStatusTag from '@/features/AgentTasks/features/TaskStatusTag';
import WorkSummaryCard from '@/features/AgentTasks/features/WorkSummaryCard';
import { getAllWorkSummaries } from '@/features/Conversation/store/slices/data/workSummaries';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { useClientDataSWR } from '@/libs/swr';
import { workKeys } from '@/libs/swr/keys';
import { workService } from '@/services/work';
import { useChatStore } from '@/store/chat';
import { dbMessageSelectors, operationSelectors } from '@/store/chat/selectors';
import { formatWorkVersionCost } from '@/utils/workVersionCost';

const TASK_STATUS_SET = new Set<TaskStatus>([
  'backlog',
  'canceled',
  'completed',
  'failed',
  'paused',
  'running',
  'scheduled',
]);

const toTaskStatus = (status?: string | null): TaskStatus =>
  status && TASK_STATUS_SET.has(status as TaskStatus) ? (status as TaskStatus) : 'backlog';

type WorksViewMode = 'history' | 'summary';

const WORKS_VIEW_MODE_STORAGE_KEY = 'lobechat-working-panel-works-view-mode';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    min-height: 0;
    padding-block: 8px;
    padding-inline: 8px 12px;
  `,
  context: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  error: css`
    padding-block: 8px;
    padding-inline: 36px 8px;
    color: ${cssVar.colorError};
  `,
  header: css`
    cursor: pointer;
    user-select: none;
    padding-block: 10px;
    padding-inline: 8px;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  modeToolbar: css`
    flex-shrink: 0;
    align-self: flex-end;
  `,
  title: css`
    min-width: 0;
    font-size: 14px;
    font-weight: 500;
  `,
  toggle: css`
    flex-shrink: 0;
  `,
  versionCost: css`
    color: ${cssVar.colorTextTertiary};
  `,
  versionList: css`
    margin-inline-start: 34px;
    padding-block: 6px 10px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  versionRow: css`
    padding-block: 6px;
    font-size: 12px;
  `,
  versionTitle: css`
    color: ${cssVar.colorTextSecondary};
  `,
  workCard: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
    background: ${cssVar.colorFillQuaternary};
  `,
}));

const VersionList = memo<{ workId: string }>(({ workId }) => {
  const { i18n, t } = useTranslation(['chat', 'common']);
  const {
    data = [],
    error,
    isLoading,
  } = useClientDataSWR<WorkVersionItem[]>(
    workKeys.versions(workId),
    () => workService.listVersions(workId),
    {
      fallbackData: [],
      revalidateOnFocus: false,
    },
  );

  if (isLoading) {
    return (
      <Center height={56}>
        <NeuralNetworkLoading size={18} />
      </Center>
    );
  }

  if (error) {
    return <Text className={styles.error}>{t('workingPanel.works.versionError')}</Text>;
  }

  if (data.length === 0) {
    return (
      <Flexbox className={styles.versionList}>
        <Text type={'secondary'}>{t('workingPanel.works.emptyVersions')}</Text>
      </Flexbox>
    );
  }

  return (
    <Flexbox className={styles.versionList}>
      {data.map((version) => {
        const cost = formatWorkVersionCost(version.cumulativeCost);
        const time = formatTaskItemDate(version.createdAt, {
          formatOtherYear: t('time.formatOtherYear', { ns: 'common' }),
          formatThisYear: t('time.formatThisYear', { ns: 'common' }),
          locale: i18n.language,
        });

        return (
          <Flexbox className={styles.versionRow} gap={4} key={version.id}>
            <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
              <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
                <Text code fontSize={12}>
                  v{version.version}
                </Text>
                <Text ellipsis className={styles.versionTitle}>
                  {t(`workingPanel.works.role.${version.role}` as never)}
                </Text>
              </Flexbox>
              <Flexbox horizontal align={'center'} gap={8} style={{ flexShrink: 0 }}>
                {cost && (
                  <Text
                    code
                    className={styles.versionCost}
                    fontSize={12}
                    title={t('workingPanel.works.cumulativeCost', { cost })}
                  >
                    {cost}
                  </Text>
                )}
                {time && (
                  <Text className={styles.context} type={'secondary'}>
                    {time}
                  </Text>
                )}
              </Flexbox>
            </Flexbox>
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

VersionList.displayName = 'VersionList';

const WorkVersionHistoryCard = memo<{ work: WorkListItem }>(({ work }) => {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const [openDocument, openTaskDetail] = useChatStore((s) => [s.openDocument, s.openTaskDetail]);
  const ToggleIcon = expanded ? ChevronDownIcon : ChevronRightIcon;
  const label = work.resourceIdentifier ?? work.resourceId;
  // The underlying task was deleted outside the tool path — the Work survives as
  // an orphan rendered from its snapshot, and opening the (gone) task detail 404s.
  const taskDeleted = work.type === 'task' && work.taskDeleted;
  // Display name comes straight from the resource snapshot (task name is live
  // from the tasks join). No synthesized fallback: a nameless resource shows
  // only its identifier label so data gaps stay visible.
  const snapshotTitle =
    work.type === 'task'
      ? work.task.name
      : work.type === 'document'
        ? work.document.title
        : work.type === 'linear'
          ? work.linear.title
          : work.github.title;
  const title = snapshotTitle?.trim();

  const externalUrl =
    work.type === 'linear' ? work.linear.url : work.type === 'github' ? work.github.url : undefined;
  // Mirrors WorkSummaryCard: linear/github rows without a URL get no title
  // click affordance — the click just falls through to the expand toggle.
  const handleTitleClick =
    work.type === 'document'
      ? () => openDocument(work.document.id)
      : work.type === 'linear' || work.type === 'github'
        ? externalUrl
          ? () => window.open(externalUrl, '_blank', 'noopener,noreferrer')
          : undefined
        : taskDeleted
          ? undefined
          : () => openTaskDetail(label);

  return (
    <Flexbox className={styles.workCard}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.header}
        gap={8}
        onClick={() => setExpanded((value) => !value)}
      >
        <ToggleIcon className={styles.toggle} size={16} />
        {work.type === 'task' ? (
          <>
            <TaskPriorityTag disableDropdown priority={work.task.priority} size={14} />
            <TaskStatusTag disableDropdown size={14} status={toTaskStatus(work.task.status)} />
          </>
        ) : work.type === 'document' ? (
          <FileTextIcon className={styles.context} size={16} />
        ) : work.type === 'linear' ? (
          <LinearIcon className={styles.context} size={16} />
        ) : (
          <Github className={styles.context} size={16} />
        )}
        <Text className={styles.context} style={{ flexShrink: 0 }}>
          {label}
        </Text>
        {taskDeleted && (
          <Tag color={'warning'} icon={<Trash2Icon size={12} />} size={'small'}>
            {t('workingPanel.works.taskDeleted')}
          </Tag>
        )}
        {title && (
          <Text
            ellipsis
            className={styles.title}
            onClick={
              handleTitleClick &&
              ((event) => {
                event.stopPropagation();
                handleTitleClick();
              })
            }
          >
            {title}
          </Text>
        )}
      </Flexbox>
      {expanded && <VersionList workId={work.id} />}
    </Flexbox>
  );
});

WorkVersionHistoryCard.displayName = 'WorkVersionHistoryCard';

const WorksModeToolbar = memo<{
  mode: WorksViewMode;
  setMode: (mode: WorksViewMode) => void;
}>(({ mode, setMode }) => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox horizontal className={styles.modeToolbar} gap={4}>
      <ActionIcon
        active={mode === 'summary'}
        icon={ListIcon}
        size={'small'}
        title={t('workingPanel.works.viewMode.summary')}
        onClick={() => setMode('summary')}
      />
      <ActionIcon
        active={mode === 'history'}
        icon={HistoryIcon}
        size={'small'}
        title={t('workingPanel.works.viewMode.history')}
        onClick={() => setMode('history')}
      />
    </Flexbox>
  );
});

WorksModeToolbar.displayName = 'WorksModeToolbar';

interface WorksSectionProps {
  /**
   * Whether the works tab is actually visible (sidebar open + this tab active).
   * Gates the history fetch so a collapsed / inactive sidebar never pulls it —
   * mirrors `ResourcesSection`'s `enabled`. Summary needs no gate: it reads the
   * message payload already in the store.
   */
  active?: boolean;
}

const WorksSection = memo<WorksSectionProps>(({ active = true }) => {
  const { t } = useTranslation('chat');
  const [mode, setMode] = useLocalStorageState<WorksViewMode>(
    WORKS_VIEW_MODE_STORAGE_KEY,
    'summary',
  );
  const topicId = useChatStore((s) => s.activeTopicId);
  const threadId = useChatStore((s) => s.activeThreadId);
  const agentId = useChatStore((s) => s.activeAgentId);
  // Is the active conversation's agent runtime still running this round? Work
  // summaries mutate on every tool_end during a run, but the lazy caches below
  // are an operation-grained concern — suppress their refresh until the run
  // settles (done / error / abort all clear this flag).
  const isRunning = useChatStore(
    operationSelectors.isAgentRuntimeRunningByContext({ agentId, threadId, topicId }),
  );

  // Summary rides the message payload — derive it in the selector so we only
  // re-render when the *works* shape changes, not on every streamed token
  // (which would thrash `isEqual` over the full `UIChatMessage[]`).
  const summaryData = useChatStore(
    // Pass the raw messages array (stable across unrelated store ticks) and let
    // getAllWorkSummaries scope + memoize by threadId; filtering here would hand
    // it a fresh array every call and defeat its identity-keyed cache.
    (s) => getAllWorkSummaries(dbMessageSelectors.activeDbMessages(s), threadId),
    isEqual,
  );

  // Runtime transports own their operation-end Work refresh. This watcher only
  // covers Work changes made outside an agent run (for example, a manual delete):
  //
  // 1. While a run is active, suppress refresh. Client registration no longer
  //    revalidates `message:list` per tool; gateway already pulls messages on
  //    tool_end (works may lag one beat until register commits).
  // 2. When `isRunning` flips false, sync the snapshot without another refresh.
  // 3. Outside a run, if summary content changes (e.g. document delete), only
  //    the lazy history/version keys need a touch.
  const wasRunningRef = useRef(false);
  const prevSummaryRef = useRef(summaryData);
  useEffect(() => {
    if (isRunning) {
      wasRunningRef.current = true;
      return;
    }

    if (wasRunningRef.current) {
      wasRunningRef.current = false;
      prevSummaryRef.current = summaryData;
      return;
    }

    if (isEqual(prevSummaryRef.current, summaryData)) return;
    prevSummaryRef.current = summaryData;
    void workService.refreshConversationViews(topicId, threadId);
  }, [summaryData, isRunning, topicId, threadId]);

  // History (version timeline) is heavier and genuinely on-demand — keep it on
  // its own lazy fetch, gated so a collapsed / inactive sidebar never pulls it.
  const {
    data: historyData = [],
    error: historyError,
    isLoading: isHistoryLoading,
  } = useClientDataSWR<WorkListItem[]>(
    mode === 'history' && topicId && active
      ? workKeys.conversation(topicId, threadId ?? null)
      : null,
    () => workService.listByConversation({ threadId, topicId }),
    {
      fallbackData: [],
      revalidateOnFocus: false,
    },
  );

  const isLoading = mode === 'history' ? isHistoryLoading : false;
  const error = mode === 'history' ? historyError : undefined;
  const data = mode === 'summary' ? summaryData : historyData;

  const content = (() => {
    if (isLoading) {
      return (
        <Center flex={1}>
          <NeuralNetworkLoading size={24} />
        </Center>
      );
    }

    if (error) {
      return (
        <Center flex={1}>
          <Empty description={t('workingPanel.works.error')} icon={ClipboardListIcon} />
        </Center>
      );
    }

    if (data.length === 0) {
      return (
        <Center flex={1}>
          <Empty description={t('workingPanel.works.empty')} icon={ClipboardListIcon} />
        </Center>
      );
    }

    return mode === 'summary'
      ? summaryData.map((work) => (
          <WorkSummaryCard className={styles.workCard} item={work} key={work.id} />
        ))
      : historyData.map((work) => <WorkVersionHistoryCard key={work.id} work={work} />);
  })();

  return (
    <Flexbox className={styles.container} flex={1} gap={12}>
      <WorksModeToolbar mode={mode} setMode={setMode} />
      {content}
    </Flexbox>
  );
});

WorksSection.displayName = 'WorksSection';

export default WorksSection;
