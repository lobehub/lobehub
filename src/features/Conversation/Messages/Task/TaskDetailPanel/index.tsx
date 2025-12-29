'use client';

import { Block, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { type TaskDetail } from '@/types/index';

import StatusContent from './StatusContent';

const styles = createStaticStyles(({ css, cssVar }) => ({
  instruction: css`
    padding-block: 12px;
    padding-inline: 16px;

    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextTertiary};
  `,
}));

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
      <Block paddingBlock={8} paddingInline={12}>
        {/* Instruction Header */}
        {instruction && (
          <Text className={styles.instruction} style={{ display: 'block' }}>
            {instruction}
          </Text>
        )}

        {/* Status Content */}
        <Block variant="outlined">
          <StatusContent content={content} messageId={messageId} taskDetail={taskDetail} />
        </Block>
      </Block>
    );
  },
);

TaskDetailPanel.displayName = 'TaskDetailPanel';

export default TaskDetailPanel;
