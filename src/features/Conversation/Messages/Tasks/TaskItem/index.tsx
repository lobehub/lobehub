'use client';

import { Block, Icon, Text } from '@lobehub/ui';
import { Check, ChevronDown, Loader2, XCircle } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ThreadStatus } from '@/types/index';
import type { UIChatMessage } from '@/types/index';

import {
  CompletedState,
  ErrorState,
  InitializingState,
  ProcessingState,
  isProcessingStatus,
} from '../shared';
import { styles } from './styles';

interface TaskItemProps {
  item: UIChatMessage;
}

const TaskItem = memo<TaskItemProps>(({ item }) => {
  const { t } = useTranslation('chat');
  const { id, content, metadata, taskDetail } = item;
  const [expanded, setExpanded] = useState(false);

  const title = taskDetail?.title || metadata?.taskTitle;
  const instruction = metadata?.instruction;
  const status = taskDetail?.status;

  // Check if task is processing using shared utility
  const isProcessing = isProcessingStatus(status);

  const isCompleted = status === ThreadStatus.Completed;
  const isError = status === ThreadStatus.Failed || status === ThreadStatus.Cancel;
  const isInitializing = !taskDetail || !status;

  const hasContent = content && content.trim().length > 0;

  const getStatusIcon = () => {
    if (isCompleted) {
      return (
        <div className={`${styles.statusIcon} ${styles.statusIconCompleted}`}>
          <Check size={10} strokeWidth={3} />
        </div>
      );
    }
    if (isError) {
      return (
        <div className={`${styles.statusIcon} ${styles.statusIconError}`}>
          <XCircle size={10} />
        </div>
      );
    }
    if (isProcessing || isInitializing) {
      return (
        <div className={`${styles.statusIcon} ${styles.statusIconProcessing}`}>
          <Icon icon={Loader2} size={10} spin />
        </div>
      );
    }
    return null;
  };

  return (
    <Block variant={'outlined'}>
      {/* Header Row: Status Icon + Title/Instruction + Expand Toggle */}
      <div className={styles.headerRow}>
        {getStatusIcon()}
        <div className={styles.titleRow}>
          {title && (
            <Text as={'h4'} fontSize={14} weight={500}>
              {title}
            </Text>
          )}
          {instruction && (
            <Text as={'p'} ellipsis={{ rows: 2 }} fontSize={12} type={'secondary'}>
              {instruction}
            </Text>
          )}
        </div>
        {/* Expand/Collapse Toggle - only show for completed tasks with content */}
        {isCompleted && hasContent && (
          <Text
            as={'span'}
            fontSize={12}
            onClick={() => setExpanded(!expanded)}
            style={{
              alignItems: 'center',
              cursor: 'pointer',
              display: 'flex',
              flexShrink: 0,
              gap: 4,
              marginInlineStart: 'auto',
            }}
            type={'secondary'}
          >
            <ChevronDown
              size={14}
              style={{
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
              }}
            />
            <span>{expanded ? t('messageAction.collapse') : t('messageAction.expand')}</span>
          </Text>
        )}
      </div>

      {/* Main Content Area */}
      <div className={styles.mainContent}>
        {/* Initializing State - no taskDetail yet */}
        {isInitializing && <InitializingState />}

        {/* Processing State */}
        {!isInitializing && isProcessing && taskDetail && (
          <ProcessingState messageId={id} taskDetail={taskDetail} variant="compact" />
        )}

        {/* Error State */}
        {!isInitializing && isError && taskDetail && <ErrorState taskDetail={taskDetail} />}

        {/* Completed State */}
        {!isInitializing && isCompleted && taskDetail && (
          <CompletedState
            content={content}
            expanded={expanded}
            taskDetail={taskDetail}
            variant="compact"
          />
        )}
      </div>
    </Block>
  );
}, Object.is);

TaskItem.displayName = 'TaskItem';

export default TaskItem;
