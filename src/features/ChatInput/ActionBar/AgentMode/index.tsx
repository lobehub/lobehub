import { ActionIcon } from '@lobehub/ui';
import { Bot } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useToggleAgentMode } from '@/features/ChatInput/hooks/useToggleAgentMode';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

const AgentModeToggle = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const enableAgentMode = useAgentStore(agentByIdSelectors.getAgentEnableModeById(agentId));
  const toggleAgentMode = useToggleAgentMode();

  return (
    <ActionIcon
      icon={Bot}
      title={t('agentMode.title', { defaultValue: 'Agent Mode' })}
      style={{
        color: enableAgentMode ? 'var(--colorPrimary)' : undefined,
      }}
      onClick={() => {
        toggleAgentMode(!enableAgentMode);
      }}
    />
  );
});

AgentModeToggle.displayName = 'AgentModeToggle';

export default AgentModeToggle;
