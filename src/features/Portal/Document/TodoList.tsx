'use client';

import { AGENT_PLAN_FILE_TYPE } from '@lobechat/const';
import { Checkbox, cssVar as cssVarValue, Flexbox, Icon, Tag } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronUp, ListTodo } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useNotebookStore } from '@/store/notebook';
import { notebookSelectors } from '@/store/notebook/selectors';
import { sx } from '@/styles/sx';

interface TodoItem {
  completed: boolean;
  text: string;
}

interface TodoState {
  items: TodoItem[];
  updatedAt: string;
}

const styles = stylex.create({
  collapsed: { overflowY: 'hidden', maxHeight: 0, paddingBlock: 0, opacity: 0 },
  container: {
    cursor: 'pointer',
    userSelect: 'none',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '8px',
    backgroundColor: { 'default': cssVar.colorBgElevated, ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
    transition: `all 0.2s ${cssVar.motionEaseInOut}`,
  },
  count: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
  expanded: { overflowY: 'auto', maxHeight: '300px', opacity: 1 },
  header: {
    overflow: 'hidden',
    fontSize: '13px',
    fontWeight: 500,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemRow: {
    paddingBlock: '6px',
    paddingInline: '4px',
    borderBlockEndWidth: { 'default': '1px', ':last-child': 0 },
    borderBlockEndStyle: { 'default': 'dashed', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
    fontSize: '13px',
  },
  listContainer: {
    overflowX: 'hidden',
    // Blockify the inline-flex Base UI Checkbox labels — without this the todo
    // rows flow inline and wrap several per line.
    display: 'flex',
    flexDirection: 'column',
    marginBlockStart: '8px',
    paddingBlock: '4px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    transition: `max-height 0.25s ${cssVar.motionEaseInOut}, opacity 0.2s ${cssVar.motionEaseInOut}, padding 0.2s ${cssVar.motionEaseInOut}`,
  },
  progress: {
    flex: '1',
    height: '4px',
    borderRadius: '2px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  progressFill: {
    height: '100%',
    borderRadius: '2px',
    backgroundColor: cssVar.colorSuccess,
    backgroundImage: 'none',
    transition: `width 0.3s ${cssVar.motionEaseInOut}`,
  },
  root: { flexShrink: 0, paddingBlockEnd: '12px', paddingInline: '12px' },
  textChecked: { color: cssVar.colorTextQuaternary, textDecoration: 'line-through' },
});

const TodoList = memo(() => {
  const { t } = useTranslation('portal');
  const [expanded, setExpanded] = useState(false);

  const [topicId, documentId] = useChatStore((s) => [
    s.activeTopicId,
    chatPortalSelectors.portalDocumentId(s),
  ]);

  const document = useNotebookStore(notebookSelectors.getDocumentById(topicId, documentId));

  // Only show for agent/plan documents with todos in metadata
  if (!document || document.fileType !== AGENT_PLAN_FILE_TYPE) return null;

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
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.container)} onClick={toggleExpanded}>
        {/* Header */}
        <Flexbox horizontal align="center" gap={8} justify="space-between">
          <Flexbox horizontal align="center" gap={8} style={{ flex: 1, minWidth: 0 }}>
            <Icon
              icon={ListTodo}
              size={16}
              style={{ color: cssVarValue.colorPrimary, flexShrink: 0 }}
            />
            <span {...stylex.props(styles.header)}>
              {currentPendingTask?.text || t('document.todos.allCompleted')}
            </span>
            <Tag size="small" style={{ flexShrink: 0 }}>
              <span {...stylex.props(styles.count)}>
                {completed}/{total}
              </span>
            </Tag>
          </Flexbox>
          <Icon
            icon={expanded ? ChevronUp : ChevronDown}
            size={16}
            style={{ color: cssVarValue.colorTextTertiary, flexShrink: 0 }}
          />
        </Flexbox>

        {/* Progress Bar */}
        <Flexbox horizontal gap={8} style={{ marginTop: 8 }}>
          <div {...stylex.props(styles.progress)}>
            <div {...sx(styles.progressFill, undefined, { width: `${progressPercent}%` })} />
          </div>
        </Flexbox>

        {/* Expandable Todo List */}
        <div {...stylex.props(styles.listContainer, expanded ? styles.expanded : styles.collapsed)}>
          {items.map((item, index) => (
            <Checkbox
              backgroundColor={cssVarValue.colorSuccess}
              checked={item.completed}
              key={index}
              shape="circle"
              style={{ borderWidth: 1.5, cursor: 'default', pointerEvents: 'none' }}
              classNames={{
                text: item.completed ? stylex.props(styles.textChecked).className : undefined,
                wrapper: stylex.props(styles.itemRow).className,
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
    </div>
  );
});

TodoList.displayName = 'TodoList';

export default TodoList;
