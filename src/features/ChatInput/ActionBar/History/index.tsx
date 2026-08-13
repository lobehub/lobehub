import { Timer, TimerOff } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import {
  agentProjectionSelectors,
  useAgentConfigStatus,
  useAgentValue,
} from '@/store/agent/projection';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import { ChatInputAction } from '../components/ChatInputAction';
import Controls from './Controls';

const History = memo(() => {
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const isLoading = useAgentConfigStatus(agentId).isLoading;
  const chatConfig = useAgentValue(agentId, agentProjectionSelectors.chatConfig);
  const { t } = useTranslation('setting');
  const isMobile = useIsMobile();

  const historyCount = useAgentValue(agentId, agentProjectionSelectors.historyCount);
  const enableHistoryCount = useAgentValue(agentId, agentProjectionSelectors.enableHistoryCount);

  if (isLoading) return <ChatInputAction disabled icon={TimerOff} />;

  const title = t(
    enableHistoryCount
      ? 'settingChat.enableHistoryCount.limited'
      : 'settingChat.enableHistoryCount.unlimited',
    { number: historyCount || 0 },
  );

  return (
    <ChatInputAction
      icon={enableHistoryCount ? Timer : TimerOff}
      showTooltip={false}
      title={title}
      popover={{
        content: <Controls />,
        minWidth: 240,
        trigger: isMobile ? 'click' : 'hover',
      }}
      onClick={
        isMobile
          ? undefined
          : async (e) => {
              e?.preventDefault?.();
              e?.stopPropagation?.();
              const next = !Boolean(chatConfig.enableHistoryCount);
              await updateAgentChatConfig({ enableHistoryCount: next });
            }
      }
    />
  );
});

export default History;
