import { cssVar } from 'antd-style';
import { Brain, BrainCircuit } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import Action from '../components/Action';
import Controls from './Controls';

const Memory = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const [isLoading, isEnabled] = useAgentStore((s) => [
    agentByIdSelectors.isAgentConfigLoadingById(agentId)(s),
    chatConfigByIdSelectors.isMemoryToolEnabledById(agentId)(s),
  ]);
  const isMobile = useIsMobile();

  if (isLoading) return <Action disabled icon={Brain} />;

  return (
    <Action
      color={isEnabled ? cssVar.colorInfo : undefined}
      icon={isEnabled ? BrainCircuit : Brain}
      showTooltip={false}
      title={t('memory.title')}
      popover={{
        content: <Controls />,
        maxWidth: 360,
        minWidth: 360,
        placement: 'topLeft',
        styles: {
          content: {
            padding: 4,
          },
        },
        trigger: isMobile ? 'click' : 'hover',
      }}
      onClick={
        isMobile
          ? undefined
          : async (e) => {
              e?.preventDefault?.();
              e?.stopPropagation?.();
              await updateAgentChatConfig({
                memory: { enabled: !isEnabled },
              });
            }
      }
    />
  );
});

Memory.displayName = 'Memory';

export default Memory;
