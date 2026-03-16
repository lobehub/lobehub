import { BrainOffIcon } from '@lobehub/ui/icons';
import { cssVar } from 'antd-style';
import { Brain } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import Action from '../components/Action';
import Controls from './Controls';
import { useMemoryEnabled } from './useMemoryEnabled';

const Memory = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const isLoading = useAgentStore((s) => agentByIdSelectors.isAgentConfigLoadingById(agentId)(s));
  const isEnabled = useMemoryEnabled(agentId);
  const isMobile = useIsMobile();

  if (isLoading) return <Action disabled icon={Brain} />;

  return (
    <Action
      color={isEnabled ? cssVar.colorInfo : undefined}
      icon={isEnabled ? Brain : BrainOffIcon}
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
