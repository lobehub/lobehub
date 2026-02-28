'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { Avatar, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx, useTheme } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { highlightTextStyles, shinyTextStyles } from '@/styles';

import type { CallAgentParams } from '../../../types';

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

export const CallAgentInspector = memo<BuiltinInspectorProps<CallAgentParams>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');
    const theme = useTheme();

    const agentId = args?.agentId || partialArgs?.agentId;
    const runAsTask = args?.runAsTask || partialArgs?.runAsTask;

    // Get agent meta from store
    const agentMeta = useAgentStore((s) =>
      agentId ? agentSelectors.getAgentMetaById(agentId)(s) : undefined,
    );

    if (isArgumentsStreaming && !agentId) {
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-agent-management.apiName.callAgent')}</span>
        </div>
      );
    }

    const titleKey = runAsTask
      ? 'builtins.lobe-agent-management.inspector.callAgent.task'
      : 'builtins.lobe-agent-management.inspector.callAgent.sync';

    const agentName = agentMeta?.title || agentId;

    return (
      <Flexbox
        align={'center'}
        className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}
        gap={8}
        horizontal
      >
        <span className={styles.title}>{t(titleKey)}</span>
        {agentMeta && (
          <Avatar
            avatar={agentMeta.avatar || DEFAULT_AVATAR}
            background={agentMeta.backgroundColor || theme.colorBgContainer}
            shape={'square'}
            size={24}
            title={agentMeta.title || undefined}
          />
        )}
        {agentName && <span className={highlightTextStyles.primary}>{agentName}</span>}
      </Flexbox>
    );
  },
);

CallAgentInspector.displayName = 'CallAgentInspector';

export default CallAgentInspector;
