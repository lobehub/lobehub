'use client';

import { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Clock } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExecuteTaskParams, ExecuteTaskState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  agentTitle: css`
    color: ${cssVar.colorTextSecondary};
  `,
  container: css`
    padding-block: 12px;
    border-radius: ${cssVar.borderRadius};
  `,
  taskContent: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillTertiary};
  `,
  timeout: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

/**
 * ExecuteTask Render component for Group Management tool
 * Read-only display of the task execution request
 */
const ExecuteTaskRender = memo<BuiltinRenderProps<ExecuteTaskParams, ExecuteTaskState>>(
  ({ args }) => {
    const { t } = useTranslation('tool');

    const timeoutMinutes = args?.timeout ? Math.round(args.timeout / 60_000) : 30;

    return (
      <Flexbox className={styles.container} gap={12}>
        {/* Header: Agent info + Timeout */}
        <Flexbox align={'center'} gap={12} horizontal justify={'space-between'}>
          <Flexbox align={'center'} flex={1} gap={12} horizontal style={{ minWidth: 0 }}>
            <span className={styles.agentTitle}>{args?.title}</span>
          </Flexbox>
          <Flexbox align="center" className={styles.timeout} gap={4} horizontal>
            <Clock size={14} />
            <span>
              {timeoutMinutes} {t('agentGroupManagement.executeTask.intervention.timeoutUnit')}
            </span>
          </Flexbox>
        </Flexbox>

        {/* Task content (read-only) */}
        {args?.task && (
          <Text className={styles.taskContent} style={{ margin: 0 }}>
            {args.task}
          </Text>
        )}
      </Flexbox>
    );
  },
);

ExecuteTaskRender.displayName = 'ExecuteTaskRender';

export default ExecuteTaskRender;
