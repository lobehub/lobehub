'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
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
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          <Flexbox horizontal align={'center'} flex={1} gap={12} style={{ minWidth: 0 }}>
            <span className={styles.agentTitle}>{args?.title}</span>
          </Flexbox>
          <Flexbox horizontal align="center" className={styles.timeout} gap={4}>
            <Clock size={14} />
            <span>
              {timeoutMinutes} {t('agentGroupManagement.executeTask.intervention.timeoutUnit')}
            </span>
          </Flexbox>
        </Flexbox>

        {/* Instruction content (read-only) */}
        {args?.instruction && (
          <Text className={styles.taskContent} style={{ margin: 0 }}>
            {args.instruction}
          </Text>
        )}
      </Flexbox>
    );
  },
);

ExecuteTaskRender.displayName = 'ExecuteTaskRender';

export default ExecuteTaskRender;
