'use client';

import { type StepContextTodos } from '@lobechat/types';
import { Checkbox, Flexbox, Icon, Tag } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDown, ChevronUp, ListTodo } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import WideScreenContainer from '@/features/WideScreenContainer';
import { selectTodosFromMessages } from '@/store/chat/slices/message/selectors/dbMessage';
import { shinyTextStyles } from '@/styles';

import { dataSelectors, messageStateSelectors, useConversationStore } from '../store';

const styles = createStaticStyles(({ css, cssVar }) => ({
  collapsed: css`
    max-height: 0;
    padding-block: 0 !important;
    opacity: 0;
  `,
  container: css`
    cursor: pointer;
    user-select: none;

    margin-block-end: 8px;
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorBgElevated};

    transition: all 0.2s ${cssVar.motionEaseInOut};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  count: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  expanded: css`
    max-height: 300px;
    opacity: 1;
  `,
  header: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  itemRow: css`
    padding-block: 6px;
    padding-inline: 4px;
    border-block-end: 1px dashed ${cssVar.colorBorderSecondary};
    font-size: 13px;

    &:last-child {
      border-block-end: none;
    }
  `,
  listContainer: css`
    overflow: hidden;

    margin-block-start: 8px;
    padding-block: 4px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    transition:
      max-height 0.25s ${cssVar.motionEaseInOut},
      opacity 0.2s ${cssVar.motionEaseInOut},
      padding 0.2s ${cssVar.motionEaseInOut};
  `,
  progress: css`
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: ${cssVar.colorFillSecondary};
  `,
  progressFill: css`
    height: 100%;
    border-radius: 2px;
    background: ${cssVar.colorSuccess};
    transition: width 0.3s ${cssVar.motionEaseInOut};
  `,
  textChecked: css`
    color: ${cssVar.colorTextQuaternary};
    text-decoration: line-through;
  `,
}));

interface TodoProgressProps {
  className?: string;
}

const TodoProgress = memo<TodoProgressProps>(({ className }) => {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);

  // Get messages and AI generating state from conversation store
  const dbMessages = useConversationStore(dataSelectors.dbMessages);
  const isAIGenerating = useConversationStore(messageStateSelectors.isAIGenerating);

  // Extract todos from messages
  const todos: StepContextTodos | undefined = useMemo(
    () => selectTodosFromMessages(dbMessages),
    [dbMessages],
  );

  // Calculate progress
  const items = todos?.items || [];
  const total = items.length;
  const completed = items.filter((item) => item.completed).length;
  const progressPercent = total > 0 ? (completed / total) * 100 : 0;

  // Find current pending task (first incomplete item)
  const currentPendingTask = items.find((item) => !item.completed);

  // Don't render if no todos
  if (total === 0) return null;

  const toggleExpanded = () => setExpanded(!expanded);

  return (
    <WideScreenContainer>
      <div className={cx(styles.container, className)} onClick={toggleExpanded}>
        {/* Header */}
        <Flexbox align="center" gap={8} horizontal justify="space-between">
          <Flexbox align="center" gap={8} horizontal style={{ flex: 1, minWidth: 0 }}>
            <Icon icon={ListTodo} size={16} style={{ color: cssVar.colorPrimary, flexShrink: 0 }} />
            <span className={cx(styles.header, isAIGenerating && shinyTextStyles.shinyText)}>
              {currentPendingTask?.text ||
                t('todoProgress.allCompleted', { defaultValue: 'All tasks completed' })}
            </span>
            <Tag size="small" style={{ flexShrink: 0 }}>
              <span className={styles.count}>
                {completed}/{total}
              </span>
            </Tag>
          </Flexbox>
          <Icon
            icon={expanded ? ChevronUp : ChevronDown}
            size={16}
            style={{ color: cssVar.colorTextTertiary, flexShrink: 0 }}
          />
        </Flexbox>

        {/* Progress Bar */}
        <Flexbox gap={8} horizontal style={{ marginTop: 8 }}>
          <div className={styles.progress}>
            <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
          </div>
        </Flexbox>

        {/* Expandable Todo List */}
        <div className={cx(styles.listContainer, expanded ? styles.expanded : styles.collapsed)}>
          {items.map((item, index) => (
            <Checkbox
              backgroundColor={cssVar.colorSuccess}
              checked={item.completed}
              classNames={{
                text: item.completed ? styles.textChecked : undefined,
                wrapper: styles.itemRow,
              }}
              key={index}
              shape="circle"
              style={{ borderWidth: 1.5, cursor: 'default', pointerEvents: 'none' }}
              textProps={{
                type: item.completed ? 'secondary' : undefined,
              }}
            >
              {item.text}
            </Checkbox>
          ))}
        </div>
      </div>
    </WideScreenContainer>
  );
});

TodoProgress.displayName = 'TodoProgress';

export default TodoProgress;
