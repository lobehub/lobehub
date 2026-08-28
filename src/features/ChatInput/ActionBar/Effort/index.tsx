import { GaugeIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import { useAgentId } from '../../hooks/useAgentId';
import { useEffectiveModel } from '../../hooks/useEffectiveModel';
import { ChatInputAction } from '../components/ChatInputAction';
import Controls from './Controls';

const EffortAction = memo<{ model: string; provider: string }>(({ model, provider }) => {
  const { t } = useTranslation('chat');

  // The saved model-instance reasoning defaults are fetched by
  // ReasoningConfigLoader (mounted in ChatInputProvider), so the dropdown and
  // the send pipeline (modelParamsResolver) read the same store value.
  return (
    <ChatInputAction
      icon={GaugeIcon}
      showTooltip={false}
      title={t('reasoningEffort.title')}
      popover={{
        content: <Controls model={model} provider={provider} />,
        maxWidth: 280,
        minWidth: 200,
        placement: 'topLeft',
        styles: {
          content: {
            padding: 4,
          },
        },
      }}
    />
  );
});

/**
 * Reasoning-effort select for the chat input. The value is a user-level
 * model-instance setting (userId + providerId + modelId, personal scope) —
 * not part of the agent's chatConfig — so it follows the user across agents.
 *
 * Mounted on every chat surface; renders nothing unless the effective model
 * declares a reasoning-effort family extend param (or reasoningMode).
 */
const Effort = memo(() => {
  const agentId = useAgentId();
  const { model, provider } = useEffectiveModel(agentId);
  const hasReasoningParams = useAiInfraStore(
    aiModelSelectors.isModelHasReasoningExtendParams(model, provider),
  );

  if (!hasReasoningParams) return null;

  return <EffortAction model={model} provider={provider} />;
});

Effort.displayName = 'Effort';

export default Effort;
