'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Markdown } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { ExecTasksParams } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  description: css`
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  instruction: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  taskItem: css`
    padding: 12px;
    border-radius: 8px;
    background: ${cssVar.colorFillQuaternary};
  `,
}));

export const ExecTasksStreaming = memo<BuiltinStreamingProps<ExecTasksParams>>(({ args }) => {
  const { tasks } = args || {};

  if (!tasks || tasks.length === 0) return null;

  return (
    <div className={styles.container}>
      {tasks.map((task, index) => (
        <div className={styles.taskItem} key={index}>
          {task.description && <div className={styles.description}>{task.description}</div>}
          {task.instruction && (
            <div className={styles.instruction}>
              <Markdown animated variant={'chat'}>
                {task.instruction}
              </Markdown>
            </div>
          )}
        </div>
      ))}
    </div>
  );
});

ExecTasksStreaming.displayName = 'ExecTasksStreaming';

export default ExecTasksStreaming;
