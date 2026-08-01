'use client';

import { TodoPanelHeader } from '@lobechat/shared-tool-ui/components';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Checkbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { CircleArrowRight } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ClaudeCodeTodoItem, TodoWriteArgs } from '../../../types';
import { computeTodoSummary, TODO_SUMMARY_LABEL_KEYS } from '../../todoSummary';

const styles = createStaticStyles(({ css, cssVar }) => ({
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

const TodoWrite = memo<BuiltinRenderProps<TodoWriteArgs>>(({ args }) => {
  const { t } = useTranslation('plugin');
  const todos = args?.todos;

  const summary = useMemo(() => computeTodoSummary(args), [args]);

  if (!todos || todos.length === 0) return null;

  return (
    <Block variant={'outlined'} width="100%">
      <TodoPanelHeader label={t(TODO_SUMMARY_LABEL_KEYS[summary.state])} summary={summary} />
      {todos.map((item, index) => (
        <TodoRow item={item} key={index} />
      ))}
    </Block>
  );
});

TodoWrite.displayName = 'ClaudeCodeTodoWrite';

export default TodoWrite;
