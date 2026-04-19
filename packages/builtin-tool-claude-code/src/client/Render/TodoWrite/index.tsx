'use client';

import { highlightTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Checkbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { CircleArrowRight, CircleCheckBig, ListTodo } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ClaudeCodeTodoItem, TodoWriteArgs } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  header: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  headerLabel: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    gap: 0;
    align-items: center;

    min-width: 0;

    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  headerCount: css`
    flex-shrink: 0;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  itemRow: css`
    width: 100%;
    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px dashed ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
  processingRow: css`
    display: flex;
    gap: 7px;
    align-items: center;
  `,
  textCompleted: css`
    color: ${cssVar.colorTextQuaternary};
    text-decoration: line-through;
  `,
  textPending: css`
    color: ${cssVar.colorTextSecondary};
  `,
  textProcessing: css`
    color: ${cssVar.colorText};
  `,
}));

interface TodoRowProps {
  item: ClaudeCodeTodoItem;
}

const TodoRow = memo<TodoRowProps>(({ item }) => {
  const { status, content, activeForm } = item;

  if (status === 'in_progress') {
    return (
      <div className={cx(styles.itemRow, styles.processingRow)}>
        <Icon icon={CircleArrowRight} size={17} style={{ color: cssVar.colorInfo }} />
        <span className={styles.textProcessing}>{activeForm || content}</span>
      </div>
    );
  }

  const isCompleted = status === 'completed';

  return (
    <Checkbox
      backgroundColor={cssVar.colorSuccess}
      checked={isCompleted}
      shape={'circle'}
      style={{ borderWidth: 1.5, cursor: 'default' }}
      classNames={{
        text: cx(styles.textPending, isCompleted && styles.textCompleted),
        wrapper: styles.itemRow,
      }}
      textProps={{
        type: isCompleted ? 'secondary' : undefined,
      }}
    >
      {content}
    </Checkbox>
  );
});

TodoRow.displayName = 'ClaudeCodeTodoRow';

interface TodoHeaderProps {
  completed: number;
  inProgress?: ClaudeCodeTodoItem;
  total: number;
}

const TodoHeader = memo<TodoHeaderProps>(({ completed, total, inProgress }) => {
  const { t } = useTranslation('plugin');
  const allDone = total > 0 && completed === total;

  const icon = inProgress ? CircleArrowRight : allDone ? CircleCheckBig : ListTodo;
  const color = inProgress
    ? cssVar.colorInfo
    : allDone
      ? cssVar.colorSuccess
      : cssVar.colorTextSecondary;

  const label = inProgress
    ? t('builtins.lobe-claude-code.todoWrite.currentStep')
    : allDone
      ? t('builtins.lobe-claude-code.todoWrite.allDone')
      : t('builtins.lobe-claude-code.todoWrite.todos');
  const detail = inProgress ? inProgress.activeForm || inProgress.content : undefined;

  return (
    <div className={styles.header}>
      <Icon icon={icon} size={16} style={{ color, flexShrink: 0 }} />
      <div className={styles.headerLabel}>
        <span>{label}</span>
        {detail && (
          <>
            <span>: </span>
            <span className={highlightTextStyles.primary}>{detail}</span>
          </>
        )}
      </div>
      <span className={styles.headerCount}>
        {completed}/{total}
      </span>
    </div>
  );
});

TodoHeader.displayName = 'ClaudeCodeTodoHeader';

const TodoWrite = memo<BuiltinRenderProps<TodoWriteArgs>>(({ args }) => {
  const todos = args?.todos;

  const stats = useMemo(() => {
    const items = todos ?? [];
    return {
      completed: items.filter((t) => t?.status === 'completed').length,
      inProgress: items.find((t) => t?.status === 'in_progress'),
      total: items.length,
    };
  }, [todos]);

  if (!todos || todos.length === 0) return null;

  return (
    <Block variant={'outlined'} width="100%">
      <TodoHeader completed={stats.completed} inProgress={stats.inProgress} total={stats.total} />
      {todos.map((item, index) => (
        <TodoRow item={item} key={index} />
      ))}
    </Block>
  );
});

TodoWrite.displayName = 'ClaudeCodeTodoWrite';

export default TodoWrite;
