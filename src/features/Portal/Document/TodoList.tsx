'use client';

import { Checkbox, Flexbox, Icon, Tag } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDown, ChevronUp, ListTodo } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useNotebookStore } from '@/store/notebook';
import { notebookSelectors } from '@/store/notebook/selectors';

interface TodoItem {
  completed: boolean;
  text: string;
}

interface TodoState {
  items: TodoItem[];
  updatedAt: string;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  collapsed: css`
    max-height: 0;
    padding-block: 0 !important;
    opacity: 0;
  `,
  container: css`
    cursor: pointer;
    user-select: none;

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

const TodoList = memo(() => {
  const { t } = useTranslation('portal');
  const [expanded, setExpanded] = useState(false);

  const [topicId, documentId] = useChatStore((s) => [
    s.activeTopicId,
    chatPortalSelectors.portalDocumentId(s),
  ]);

  const document = useNotebookStore(notebookSelectors.getDocumentById(topicId, documentId));

  // Only show for agent/plan documents with todos in metadata
  if (!document || document.fileType !== 'agent/plan') return null;

  const todos: TodoState | undefined = document.metadata?.todos;
  const items = todos?.items || [];

  if (items.length === 0) return null;

  const total = items.length;
  const completed = items.filter((item) => item.completed).length;
  const progressPercent = total > 0 ? (completed / total) * 100 : 0;

  // Find current pending task (first incomplete item)
  const currentPendingTask = items.find((item) => !item.completed);

  const toggleExpanded = () => setExpanded(!expanded);

  return (
    <div className={styles.container} onClick={toggleExpanded}>
      {/* Header */}
      <Flexbox horizontal align="center" gap={8} justify="space-between">
        <Flexbox horizontal align="center" gap={8} style={{ flex: 1, minWidth: 0 }}>
          <Icon icon={ListTodo} size={16} style={{ color: cssVar.colorPrimary, flexShrink: 0 }} />
          <span className={styles.header}>
            {currentPendingTask?.text || t('document.todos.allCompleted')}
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
      <Flexbox horizontal gap={8} style={{ marginTop: 8 }}>
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
            key={index}
            shape="circle"
            style={{ borderWidth: 1.5, cursor: 'default', pointerEvents: 'none' }}
            classNames={{
              text: item.completed ? styles.textChecked : undefined,
              wrapper: styles.itemRow,
            }}
            textProps={{
              type: item.completed ? 'secondary' : undefined,
            }}
          >
            {item.text}
          </Checkbox>
        ))}
      </div>
    </div>
  );
});

TodoList.displayName = 'TodoList';

export default TodoList;
