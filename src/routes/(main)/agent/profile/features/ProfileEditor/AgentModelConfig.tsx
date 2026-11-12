'use client';

import { Alert, Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { Bot } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AGENT_SHARE_ALLOWED_PROVIDERS } from '@/business/agent-share';
import { useAgentShareSupported } from '@/business/client/useAgentShareSupported';
import ModelSelect from '@/features/ModelSelect';
import ReasoningEffortSelect from '@/features/ModelSelect/ReasoningEffortSelect';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { AgentConfigCard } from './AgentConfigCard';

interface AgentModelConfigProps {
  agentId: string;
}

/**
 * The agent's model and its default reasoning effort — the same card for
 * personal and workspace agents. Whether workspace members may switch the
 * model is configured on the Agent's Permission page; this card only picks it.
 */
export const AgentModelConfig = memo<AgentModelConfigProps>(({ agentId }) => {
  const { t } = useTranslation(['setting', 'agent']);
  const { allowed: canEdit } = usePermission('edit_own_content');
  const config = useAgentStore(agentSelectors.getAgentConfigById(agentId), isEqual);
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const { isShared } = useAgentShareSupported(agentId);
  const providerIds =
    isShared && AGENT_SHARE_ALLOWED_PROVIDERS ? [...AGENT_SHARE_ALLOWED_PROVIDERS] : undefined;

  if (!config) return null;

  return (
    <AgentConfigCard icon={Bot} title={t('settingAgent.modelPolicy.title')}>
      <Flexbox horizontal align={'center'} gap={8}>
        <ModelSelect
          disabled={!canEdit}
          providerIds={providerIds}
          style={{ flex: 1, minWidth: 0 }}
          value={{ model: config.model, provider: config.provider }}
          onChange={(value) => {
            if (!canEdit) return;

            void updateAgentConfigById(agentId, value);
          }}
        />
        {config.model && config.provider && (
          <ReasoningEffortSelect
            disabled={!canEdit}
            model={config.model}
            provider={config.provider}
          />
        )}
      </Flexbox>
      {providerIds && (
        <Alert
          showIcon
          description={t('share.settings.modelRestriction.description', { ns: 'agent' })}
          title={t('share.settings.modelRestriction.title', { ns: 'agent' })}
          type={'info'}
        />
      )}
    </AgentConfigCard>
  );
});

AgentModelConfig.displayName = 'AgentModelConfig';
