'use client';

import { Block, Checkbox, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useNotebookStore } from '@/store/notebook';
import { notebookSelectors } from '@/store/notebook/selectors';

import { useDocumentEditorStore } from './store';

interface TodoItem {
  completed: boolean;
  text: string;
}

interface TodoState {
  items: TodoItem[];
  updatedAt: string;
}

const useStyles = createStyles(({ css, token }) => ({
  header: css`
    cursor: pointer;

    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${token.colorBorderSecondary};

    transition: background-color 0.2s;

    &:hover {
      background-color: ${token.colorFillTertiary};
    }
  `,
  headerCollapsed: css`
    border-block-end: none;
  `,
  itemRow: css`
    width: 100%;
    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px dashed ${token.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
  textChecked: css`
    color: ${token.colorTextQuaternary};
    text-decoration: line-through;
  `,
}));

interface ReadOnlyTodoItemProps {
  completed: boolean;
  text: string;
}

const ReadOnlyTodoItem = memo<ReadOnlyTodoItemProps>(({ text, completed }) => {
  const { styles, theme } = useStyles();

  return (
    <Checkbox
      backgroundColor={theme.colorSuccess}
      checked={completed}
      classNames={{ text: completed ? styles.textChecked : undefined, wrapper: styles.itemRow }}
      shape={'circle'}
      style={{ borderWidth: 1.5, cursor: 'default' }}
      textProps={{
        type: completed ? 'secondary' : undefined,
      }}
    >
      {text}
    </Checkbox>
  );
});

ReadOnlyTodoItem.displayName = 'ReadOnlyTodoItem';

const TodoList = memo(() => {
  const { t } = useTranslation('portal');
  const { styles, cx } = useStyles();
  const [collapsed, setCollapsed] = useState(false);

  const documentId = useDocumentEditorStore((s) => s.documentId);
  const topicId = useDocumentEditorStore((s) => s.topicId);

  const document = useNotebookStore(notebookSelectors.getDocumentById(topicId, documentId));

  // Only show for agent/plan documents with todos in metadata
  if (!document || document.fileType !== 'agent/plan') return null;

  const todos: TodoState | undefined = document.metadata?.todos;
  const items = todos?.items || [];

  if (items.length === 0) return null;

  const completedCount = items.filter((item) => item.completed).length;

  return (
    <Flexbox gap={0}>
      <Block variant={'outlined'} width="100%">
        <Flexbox
          align="center"
          className={cx(styles.header, collapsed && styles.headerCollapsed)}
          horizontal
          justify="space-between"
          onClick={() => setCollapsed(!collapsed)}
        >
          <Flexbox align="center" gap={8} horizontal>
            <Icon icon={collapsed ? ChevronUp : ChevronDown} size={16} />
            <Text style={{ fontSize: 14 }} type="secondary" weight={500}>
              {t('document.todos.title', { ns: 'portal' })}
            </Text>
          </Flexbox>
          <Text style={{ fontSize: 12, opacity: 0.45 }}>
            {completedCount}/{items.length}
          </Text>
        </Flexbox>
        {!collapsed &&
          items.map((item, index) => (
            <ReadOnlyTodoItem completed={item.completed} key={index} text={item.text} />
          ))}
      </Block>
    </Flexbox>
  );
});

TodoList.displayName = 'TodoList';

export default TodoList;
