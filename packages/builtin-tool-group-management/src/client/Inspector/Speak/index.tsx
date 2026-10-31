'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx, Flexbox, useTheme } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { highlightTextStyles, shinyTextStyles } from '@/styles';

import type { SpeakParams } from '../../../types';

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

export const SpeakInspector = memo<BuiltinInspectorProps<SpeakParams>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const agentId = args?.agentId || partialArgs?.agentId;

    // Get active group ID and agent from store
    const activeGroupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
    const agent = useAgentGroupStore((s) =>
      activeGroupId && agentId
        ? agentGroupSelectors.getAgentByIdFromGroup(activeGroupId, agentId)(s)
        : undefined,
    );
    const theme = useTheme();

    if (isArgumentsStreaming && !agent) {
      return (
        <div className={styles.root}>
          <span className={shinyTextStyles.shinyText}>
            {t('builtins.lobe-group-management.apiName.speak')}
          </span>
        </div>
      );
    }

    const agentName = agent?.title || agentId;

    return (
      <Flexbox horizontal align={'center'} className={styles.root} gap={8}>
        <span className={cx(styles.title, isArgumentsStreaming && shinyTextStyles.shinyText)}>
          {t('builtins.lobe-group-management.inspector.speak.title')}
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
        {agentName && <span className={highlightTextStyles.primary}>{agentName}</span>}
      </Flexbox>
    );
  },
);

SpeakInspector.displayName = 'SpeakInspector';

export default SpeakInspector;
