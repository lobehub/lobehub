import { Center, Collapse, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckCircle, Circle, ListCheck } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  collapse: css`
    padding-block: 0;
    padding-inline: ${cssVar.paddingXS};

    .ant-collapse-content-box {
      padding: 0;
    }

    .ant-collapse-header {
      padding: 0 !important;
      color: ${cssVar.colorTextTertiary};
    }

    .ant-collapse-expand-icon {
      color: ${cssVar.colorTextTertiary} !important;
    }
  `,
}));

export interface TodoItem {
  assignee?: string;
  content: string;
  finished?: boolean;
}

export interface TodoListProps {
  /**
   * Optional function to resolve assignee ID to display name
   */
  resolveAssigneeName?: (assignee: string) => string | undefined;
  /**
   * List of todo items
   */
  todos: TodoItem[];
}

const TodoList = memo<TodoListProps>(({ todos, resolveAssigneeName }) => {
  const { t } = useTranslation('chat');

  const completedCount = todos.filter((todo) => todo.finished).length;
  const totalCount = todos.length;

  // Create the header with progress indicator
  const headerContent = (
    <Flexbox horizontal align="center" gap={8} style={{ maxWidth: '100%', overflow: 'hidden' }}>
      <Icon color={cssVar.colorTextTertiary} icon={ListCheck} size={16} style={{ flexShrink: 0 }} />
      <Text
        color={cssVar.colorTextTertiary}
        ellipsis={{ tooltip: true }}
        style={{ flex: 1 }}
        weight={400}
      >
        {completedCount} / {totalCount} {t('supervisor.todoList.title')}
      </Text>
    </Flexbox>
  );

  // Create todo items content
  const todoItems =
    todos.length === 0 ? (
      <Flexbox horizontal align="center" gap={8} padding="8px 0">
        <CheckCircle color={cssVar.colorSuccess} size={16} />
        <span
          style={{
            color: cssVar.colorTextSecondary,
            fontSize: cssVar.fontSizeSM,
          }}
        >
          {t('supervisor.todoList.allComplete')}
        </span>
      </Flexbox>
    ) : (
      <Flexbox gap={0}>
        {todos.map((todo, index) => (
          <Flexbox
            horizontal
            align="center"
            gap={8}
            key={index}
            style={{
              borderBottom:
                index < todos.length - 1 ? `1px solid ${cssVar.colorBorderSecondary}` : 'none',
              padding: '8px 0',
              width: '100%',
            }}
          >
            <Center
              style={{
                color: todo.finished ? cssVar.colorSuccess : cssVar.colorTextTertiary,
                flexShrink: 0,
              }}
            >
              {todo.finished ? <CheckCircle size={16} /> : <Circle size={16} />}
            </Center>
            <span
              style={{
                color: todo.finished ? cssVar.colorTextTertiary : cssVar.colorText,
                fontSize: cssVar.fontSize,
                textDecoration: todo.finished ? 'line-through' : 'none',
              }}
            >
              {todo.content}
            </span>
            {todo.assignee && (
              <span
                style={{
                  color: cssVar.colorTextTertiary,
                  fontSize: cssVar.fontSizeSM,
                  marginLeft: 6,
                }}
              >
                @{resolveAssigneeName?.(todo.assignee) ?? todo.assignee}
              </span>
            )}
          </Flexbox>
        ))}
      </Flexbox>
    );

  return (
    <Collapse
      className={styles.collapse}
      expandIconPlacement="end"
      size="small"
      variant="borderless"
      items={[
        {
          children: todoItems,
          key: 'todos',
          label: headerContent,
        },
      ]}
      styles={{
        header: {
          fontSize: cssVar.fontSize,
        },
      }}
    />
  );
});

TodoList.displayName = 'TodoList';

export default TodoList;
