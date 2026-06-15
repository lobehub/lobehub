'use client';

import { Alert } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

const styles = createStaticStyles(({ css }) => ({
  alert: css`
    .ant-alert-message {
      font-size: 12px;
      line-height: 18px !important;
    }

    .ant-alert-icon {
      height: 18px !important;
    }
  `,
}));

/**
 * Warns the user when Agent mode is enabled but the currently selected model
 * does not support function/tool calling — agentic runs need tool calling to
 * work, so we suggest switching to a model with agent capability.
 */
const AgentModeNotice = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();

  const [enableAgentMode, model, provider] = useAgentStore((s) => [
    agentByIdSelectors.getAgentEnableModeById(agentId)(s),
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
  ]);

  const supportToolUse = useAiInfraStore(aiModelSelectors.isModelSupportToolUse(model, provider));

  if (!enableAgentMode || supportToolUse) return null;

  return (
    <Alert
      classNames={{ alert: cx(styles.alert) }}
      style={{ fontSize: 12 }}
      title={t('input.agentModeUnsupportedModel')}
      type={'warning'}
      variant={'borderless'}
    />
  );
});

AgentModeNotice.displayName = 'AgentModeNotice';

export default AgentModeNotice;
