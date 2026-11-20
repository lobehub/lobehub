'use client';

import { TodoPanelHeader } from '@lobechat/shared-tool-ui/components';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Checkbox, cx, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleArrowRight } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ClaudeCodeTodoItem, TodoWriteArgs } from '../../../types';
import { computeTodoSummary, TODO_SUMMARY_LABEL_KEYS } from '../../todoSummary';

const styles = stylex.create({
  itemRow: {
    width: '100%',
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: { 'default': 'dashed', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  processingRow: { display: 'flex', gap: '7px', alignItems: 'center' },
  textCompleted: { color: cssVar.colorTextQuaternary, textDecoration: 'line-through' },
  textPending: { color: cssVar.colorTextSecondary },
  textProcessing: { color: cssVar.colorText },
});

interface TodoRowProps {
  item: ClaudeCodeTodoItem;
}

const TodoRow = memo<TodoRowProps>(({ item }) => {
  const { status, content, activeForm } = item;

  if (status === 'in_progress') {
    return (
      <div {...stylex.props(styles.itemRow, styles.processingRow)}>
        <Icon icon={CircleArrowRight} size={17} style={{ color: cssVar.colorInfo }} />
        <span {...stylex.props(styles.textProcessing)}>{activeForm || content}</span>
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
        text: cx(stylex.props(styles.textPending, isCompleted && styles.textCompleted).className),
        wrapper: stylex.props(styles.itemRow).className,
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
