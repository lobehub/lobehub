import { ActionIcon } from '@lobehub/ui';
import { Bot } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

const AgentModeToggle = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const [enableAgentMode, updateAgentConfigById] = useAgentStore((s) => [
    agentByIdSelectors.getAgentEnableModeById(agentId)(s),
    s.updateAgentConfigById,
  ]);

  const handleToggle = (checked: boolean) => {
    updateAgentConfigById(agentId, { enableAgentMode: checked });
  };

  return (
    <ActionIcon
      icon={Bot}
      onClick={() => {
        handleToggle(!enableAgentMode);
      }}
      style={{
        color: enableAgentMode ? 'var(--colorPrimary)' : undefined,
      }}
      title={t('agentMode.title', { defaultValue: 'Agent Mode' })}
    />
  );
});

AgentModeToggle.displayName = 'AgentModeToggle';

export default AgentModeToggle;
