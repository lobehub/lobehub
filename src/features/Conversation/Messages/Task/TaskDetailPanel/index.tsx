'use client';

import { Block, Text } from '@lobehub/ui';
import { memo } from 'react';

import { type TaskDetail } from '@/types/index';

import StatusContent from './StatusContent';

interface TaskDetailPanelProps {
  content?: string;
  instruction?: string;
  /**
   * Message ID for updating task status in store
   */
  messageId: string;
  taskDetail?: TaskDetail;
}

const TaskDetailPanel = memo<TaskDetailPanelProps>(
  ({ taskDetail, instruction, content, messageId }) => {
    return (
      <>
        {/* Instruction Header */}
        {instruction && (
          <Block padding={12}>
            <Text fontSize={13} type={'secondary'}>
              {instruction}
            </Text>
          </Block>
        )}

        {/* Status Content */}
        <StatusContent content={content} messageId={messageId} taskDetail={taskDetail} />
      </>
    );
  },
);

TaskDetailPanel.displayName = 'TaskDetailPanel';

export default TaskDetailPanel;
