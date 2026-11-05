'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx, Flexbox, useTheme } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { highlightTextStyles, shinyGroupStyles, shinyTextStyles } from '@/styles';

import type { ExecuteTaskParams } from '../../../types';

const styles = stylex.create({
  root: { overflow: 'hidden', display: 'flex', gap: '8px', alignItems: 'center' },
  title: { flexShrink: 0, color: cssVar.colorTextSecondary, whiteSpace: 'nowrap' },
});

export const ExecuteAgentTaskInspector = memo<BuiltinInspectorProps<ExecuteTaskParams>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const agentId = args?.agentId || partialArgs?.agentId;
    const taskTitle = args?.title || partialArgs?.title;

    // Get active group ID and agent from store
    const activeGroupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
    const agent = useAgentGroupStore((s) =>
      activeGroupId && agentId
        ? agentGroupSelectors.getAgentByIdFromGroup(activeGroupId, agentId)(s)
        : undefined,
    );
    const theme = useTheme();

    if (isArgumentsStreaming) {
      if (!agent && !taskTitle)
        return (
          <div {...stylex.props(styles.root)}>
            <span className={shinyTextStyles.shinyText}>
              {t('builtins.lobe-group-management.apiName.executeAgentTask')}
            </span>
          </div>
        );
      if (agent) {
        return (
          <Flexbox
            horizontal
            align={'center'}
            className={cx(stylex.props(styles.root).className, shinyGroupStyles.shinyGroup)}
            gap={8}
          >
            <span
              className={cx(
                stylex.props(styles.title).className,
                isArgumentsStreaming && shinyTextStyles.shinyText,
              )}
            >
              {t('builtins.lobe-group-management.inspector.executeAgentTask.assignTo')}
            </span>
            {agent && (
              <>
                <AgentAvatar
                  agentId={agentId}
                  avatar={agent.avatar}
                  background={agent.backgroundColor || theme.colorBgContainer}
                  shape={'square'}
                  size={24}
                  title={agent.title || undefined}
                />
                <span className={cx(isArgumentsStreaming && shinyTextStyles.shinyText)}>
                  {agent?.title}
                </span>
              </>
            )}
            {taskTitle && (
              <>
                <span {...stylex.props(styles.title)}>
                  {t('builtins.lobe-group-management.inspector.executeAgentTask.task')}
                </span>
                <span className={highlightTextStyles.primary}>{taskTitle}</span>
              </>
            )}
          </Flexbox>
        );
      }
    }

    const agentName = agent?.title || agentId;

    return (
      <Flexbox horizontal align={'center'} className={stylex.props(styles.root).className} gap={8}>
        <span
          className={cx(
            stylex.props(styles.title).className,
            isArgumentsStreaming && shinyTextStyles.shinyText,
          )}
        >
          {t('builtins.lobe-group-management.inspector.executeAgentTask.assignTo')}
        </span>
        {agent && (
          <AgentAvatar
            agentId={agentId}
            avatar={agent.avatar}
            background={agent.backgroundColor || theme.colorBgContainer}
            shape={'square'}
            size={24}
            title={agent.title || undefined}
          />
        )}
        {agentName && <span>{agentName}</span>}
        {taskTitle && (
          <>
            <span {...stylex.props(styles.title)}>
              {t('builtins.lobe-group-management.inspector.executeAgentTask.task')}
            </span>
            <span className={highlightTextStyles.primary}>{taskTitle}</span>
          </>
        )}
      </Flexbox>
    );
  },
);
