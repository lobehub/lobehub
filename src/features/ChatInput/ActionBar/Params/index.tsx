import { Settings2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentConfigStatus } from '@/store/agent/projection';

import { useAgentId } from '../../hooks/useAgentId';
import { ChatInputAction } from '../components/ChatInputAction';
import Controls from './Controls';

const Params = memo(() => {
  const agentId = useAgentId();
  const { isLoading } = useAgentConfigStatus(agentId);
  const { t } = useTranslation('setting');

  if (isLoading) return <ChatInputAction disabled icon={Settings2Icon} />;

  return (
    <ChatInputAction
      icon={Settings2Icon}
      showTooltip={false}
      title={t('settingModel.params.title')}
      popover={{
        content: <Controls />,
        maxWidth: 384,
        minWidth: 384,
        styles: {
          content: {
            borderRadius: 16,
            overflow: 'hidden',
            padding: 0,
          },
        },
      }}
    />
  );
});

export default Params;
