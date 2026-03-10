'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { Avatar, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx, useTheme } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { highlightTextStyles, shinyTextStyles } from '@/styles';

import type { ExecuteTaskParams } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  title: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;
  `,
}));

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
          <div className={cx(styles.root, shinyTextStyles.shinyText)}>
            <span>{t('builtins.lobe-group-management.apiName.executeAgentTask')}</span>
          </div>
        );
      if (agent) {
        return (
          <Flexbox
            horizontal
            align={'center'}
            className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}
            gap={8}
          >
            <span className={styles.title}>
              {t('builtins.lobe-group-management.inspector.executeAgentTask.assignTo')}
            </span>
            {agent && (
              <>
                <Avatar
                  avatar={agent.avatar || DEFAULT_AVATAR}
                  background={agent.backgroundColor || theme.colorBgContainer}
                  shape={'square'}
                  size={24}
                  title={agent.title || undefined}
                />
                <span>{agent?.title}</span>
              </>
            )}
            {taskTitle && (
              <>
                <span className={styles.title}>
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
      <Flexbox
        horizontal
        align={'center'}
        className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}
        gap={8}
      >
        <span className={styles.title}>
          {t('builtins.lobe-group-management.inspector.executeAgentTask.assignTo')}
        </span>
        {agent && (
          <Avatar
            avatar={agent.avatar || DEFAULT_AVATAR}
            background={agent.backgroundColor || theme.colorBgContainer}
            shape={'square'}
            size={24}
            title={agent.title || undefined}
          />
        )}
        {agentName && <span>{agentName}</span>}
        {taskTitle && (
          <>
            <span className={styles.title}>
              {t('builtins.lobe-group-management.inspector.executeAgentTask.task')}
            </span>
            <span className={highlightTextStyles.primary}>{taskTitle}</span>
          </>
        )}
      </Flexbox>
    );
  },
);
