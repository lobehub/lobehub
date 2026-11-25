'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightMessageWhenScrollSettles } from '@/features/Portal/TopicComments/messageLocator';
import { useChatStore } from '@/store/chat';
import { displayMessageSelectors } from '@/store/chat/selectors';
import { getLocalBackgroundTaskStopper } from '@/store/chat/slices/agentRun/actions/transports/hetero/backgroundTasks';

import { SectionHeader } from '../SectionHeader';
import { sectionProps } from '../sectionStyles';
import {
  type BackgroundTaskItem,
  groupBackgroundTasks,
  locateToolCall,
  outputDirectoryOf,
  resolveStopRoute,
} from './backgroundTaskList';
import { BackgroundTaskRow } from './BackgroundTaskRow';
import { useBackgroundTasks } from './useBackgroundTasks';

interface BackgroundTasksSectionProps {
  afterBreak?: boolean;
  /** Routes the output read to a connected device; empty for this device. */
  deviceId?: string;
  /** Whether this client can read the run's files (this device or a connected one). */
  outputReadable: boolean;
}

const locate = ({ toolCallId }: BackgroundTaskItem) => {
  const state = useChatStore.getState();
  const location = locateToolCall(displayMessageSelectors.mainDisplayChats(state), toolCallId);
  const scrollToIndex = state.mainConversationScrollToIndex;
  if (!location || !scrollToIndex) return;
  requestAnimationFrame(() => {
    scrollToIndex(location.index, { align: 'center', smooth: true });
    highlightMessageWhenScrollSettles(location.elementId);
  });
};

/**
 * Background tasks a Claude Code run started (`run_in_background` Bash,
 * Monitor). Running ones all show; finished ones fold to the most recent few.
 */
export const BackgroundTasksSection = ({
  afterBreak,
  deviceId,
  outputReadable,
}: BackgroundTasksSectionProps) => {
  const { t } = useTranslation('chat');
  const { items, liveOperations } = useBackgroundTasks();
  const [showAllFinished, setShowAllFinished] = useState(false);
  const openLocalFile = useChatStore((s) => s.openLocalFile);

  const viewOutput = useCallback(
    (path: string) =>
      openLocalFile({
        allowExternalFilePreview: true,
        deviceId,
        filePath: path,
        workingDirectory: outputDirectoryOf(path),
      }),
    [deviceId, openLocalFile],
  );

  if (items.length === 0) return null;

  const { finished, hiddenCount, running } = groupBackgroundTasks(items, showAllFinished);

  const renderRow = (item: BackgroundTaskItem) => (
    <BackgroundTaskRow
      item={item}
      key={item.messageId}
      stopRoute={resolveStopRoute(
        liveOperations,
        item.task.operationId,
        !!item.task.operationId && !!getLocalBackgroundTaskStopper(item.task.operationId),
      )}
      onLocate={locate}
      onViewOutput={outputReadable ? viewOutput : undefined}
    />
  );

  return (
    <Flexbox {...sectionProps(afterBreak)}>
      <SectionHeader
        count={running.length > 0 ? running.length : undefined}
        title={t('workingPanel.overview.backgroundTasks.title')}
      />
      {running.map(renderRow)}
      {finished.map(renderRow)}
      {(hiddenCount > 0 || showAllFinished) && (
        <Button
          size={'small'}
          style={{ alignSelf: 'flex-start' }}
          type={'text'}
          onClick={() => setShowAllFinished((value) => !value)}
        >
          {showAllFinished
            ? t('workingPanel.overview.backgroundTasks.collapse')
            : t('workingPanel.overview.backgroundTasks.showAll', { count: hiddenCount })}
        </Button>
      )}
    </Flexbox>
  );
};
