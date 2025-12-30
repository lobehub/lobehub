'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { ExecTasksParams, ExecTasksState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  index: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,

  taskItem: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;

    padding-block: 12px;
    padding-inline: 12px;
    border-block-end: 1px dashed ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
}));

export const ExecTasksRender = memo<BuiltinRenderProps<ExecTasksParams, ExecTasksState>>(
  ({ pluginState }) => {
    const { tasks } = pluginState || {};

    if (!tasks || tasks.length === 0) return null;

    return (
      <Block variant={'outlined'} width="100%">
        {tasks.map((task, index) => (
          <div className={styles.taskItem} key={index}>
            <div className={styles.index}>{index + 1}.</div>
            <div>
              {task.description && (
                <Text as={'h4'} fontSize={14} weight={500}>
                  {task.description}
                </Text>
              )}
              {task.instruction && (
                <Text as={'p'} ellipsis={{ rows: 2 }} fontSize={12} type={'secondary'}>
                  {task.instruction}
                </Text>
              )}
            </div>
          </div>
        ))}
      </Block>
    );
  },
);

ExecTasksRender.displayName = 'ExecTasksRender';

export default ExecTasksRender;
