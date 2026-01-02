'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { ExecTaskParams, ExecTaskState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  instruction: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
  `,
  taskContent: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;

    min-width: 0;
  `,
  taskItem: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;

    padding-block: 10px;
    padding-inline: 12px;
  `,
  title: css`
    font-size: 13px;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
}));

export const ExecTaskRender = memo<BuiltinRenderProps<ExecTaskParams, ExecTaskState>>(
  ({ pluginState }) => {
    const { task } = pluginState || {};

    if (!task) return null;

    return (
      <Block variant={'outlined'} width="100%">
        <div className={styles.taskItem}>
          <div className={styles.taskContent}>
            {task.description && <div className={styles.title}>{task.description}</div>}
            {task.instruction && <div className={styles.instruction}>{task.instruction}</div>}
          </div>
        </div>
      </Block>
    );
  },
);

ExecTaskRender.displayName = 'ExecTaskRender';

export default ExecTaskRender;
