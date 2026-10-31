import type { WorkListItem } from '@lobechat/types';
import { ActionIcon, Center, createStaticStyles, Empty, Flexbox, Spin } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { ClipboardListIcon, HistoryIcon, ListIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { getAllWorkSummaries } from '@/features/Conversation/store/slices/data/workSummaries';
import WorkSummaryCard from '@/features/Work/WorkSummaryCard';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { workService } from '@/services/work';
import { useChatStore } from '@/store/chat';
import { dbMessageSelectors, operationSelectors } from '@/store/chat/selectors';
import { useWorkStore, workActions, workSelectors } from '@/store/work';

import WorkVersionHistoryCard from './WorkVersionHistoryCard';

type WorksViewMode = 'history' | 'summary';

const WORKS_VIEW_MODE_STORAGE_KEY = 'lobechat-working-panel-works-view-mode';

const EMPTY_HISTORY: WorkListItem[] = [];

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    min-height: 0;
    padding-block: 8px;
    padding-inline: 8px 12px;
  `,
  modeToolbar: css`
    flex-shrink: 0;
    align-self: flex-end;
  `,
  workCard: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
    background: ${cssVar.colorFillQuaternary};
  `,
}));

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
  // its own lazy sync, gated so a collapsed / inactive sidebar never pulls it.
  // It is a replica: a revisit or reload paints the last history first.
  const historyParams = useMemo(
    () => (mode === 'history' && topicId && active ? { threadId, topicId } : null),
    [active, mode, threadId, topicId],
  );
  const historySync = workActions.useFetchConversationWorks(historyParams, {
    revalidateOnFocus: false,
  });
  const storedHistory = useWorkStore(workSelectors.conversationWorks(historyParams));
  const historyData = storedHistory ?? EMPTY_HISTORY;
  const historyPending = !!historyParams && storedHistory === undefined;

  // Settled history stays on screen when a background refresh fails.
  const error = historyPending ? historySync.error : undefined;
  // Before the stored copy is read, paint nothing rather than a spinner the
  // cached history replaces a frame later.
  const isHydrating = historyPending && !historySync.isHydrated;
  const isLoading = historyPending && !error && !isHydrating;
  const data = mode === 'summary' ? summaryData : historyData;

  const content = (() => {
    if (isHydrating) return null;

    if (isLoading) {
      return (
        <Center flex={1}>
          <Spin size="middle" />
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
