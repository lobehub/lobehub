'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Clock } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExecuteTaskParams, ExecuteTaskState } from '../../../types';

const styles = stylex.create({
  agentTitle: { color: cssVar.colorTextSecondary },
  container: { paddingBlock: '12px', borderRadius: cssVar.borderRadius },
  taskContent: {
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadius,
    background: cssVar.colorFillTertiary,
  },
  timeout: { fontSize: '12px', color: cssVar.colorTextTertiary },
});

/**
 * ExecuteTask Render component for Group Management tool
 * Read-only display of the task execution request
 */
const ExecuteTaskRender = memo<BuiltinRenderProps<ExecuteTaskParams, ExecuteTaskState>>(
  ({ args }) => {
    const { t } = useTranslation('tool');

    const timeoutMinutes = args?.timeout ? Math.round(args.timeout / 60_000) : 30;

    return (
      <Flexbox className={stylex.props(styles.container).className} gap={12}>
        {/* Header: Agent info + Timeout */}
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          <Flexbox horizontal align={'center'} flex={1} gap={12} style={{ minWidth: 0 }}>
            <span {...stylex.props(styles.agentTitle)}>{args?.title}</span>
          </Flexbox>
          <Flexbox
            horizontal
            align="center"
            className={stylex.props(styles.timeout).className}
            gap={4}
          >
            <Clock size={14} />
            <span>
              {timeoutMinutes} {t('agentGroupManagement.executeTask.intervention.timeoutUnit')}
            </span>
          </Flexbox>
        </Flexbox>

        {/* Instruction content (read-only) */}
        {args?.instruction && (
          <Text className={stylex.props(styles.taskContent).className} style={{ margin: 0 }}>
            {args.instruction}
          </Text>
        )}
      </Flexbox>
    );
  },
);

ExecuteTaskRender.displayName = 'ExecuteTaskRender';

export default ExecuteTaskRender;
