'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Block, Markdown } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { ExecTasksParams } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  index: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
  instruction: css`
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
    border-block-end: 1px dashed ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
  title: css`
    font-size: 13px;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
}));

export const ExecTasksStreaming = memo<BuiltinStreamingProps<ExecTasksParams>>(({ args }) => {
  const { tasks } = args || {};

  if (!tasks || tasks.length === 0) return null;

  return (
    <Block variant={'outlined'} width="100%">
      {tasks.map((task, index) => (
        <div className={styles.taskItem} key={index}>
          <div className={styles.index}>{index + 1}.</div>
          <div className={styles.taskContent}>
            {task.description && <div className={styles.title}>{task.description}</div>}
            {task.instruction && (
              <div className={styles.instruction}>
                <Markdown animated variant={'chat'}>
                  {task.instruction}
                </Markdown>
              </div>
            )}
          </div>
        </div>
      ))}
    </Block>
  );
});

ExecTasksStreaming.displayName = 'ExecTasksStreaming';

export default ExecTasksStreaming;
