import { ActionIcon } from '@lobehub/ui';
import { BotMessageSquareIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGroupProfileStore } from '@/store/groupProfile';
import { useHeaderActionSize } from '@/styles/density';

const AgentBuilderToggle = memo(() => {
  const { t } = useTranslation('chat');
  const chatPanelExpanded = useGroupProfileStore((s) => s.chatPanelExpanded);
  const setChatPanelExpanded = useGroupProfileStore((s) => s.setChatPanelExpanded);
  const headerActionSize = useHeaderActionSize();

  return (
    <ActionIcon
      active={chatPanelExpanded}
      aria-label={t('agentBuilder.title')}
      icon={BotMessageSquareIcon}
      size={headerActionSize}
      title={t('agentBuilder.title')}
      onClick={() => setChatPanelExpanded((prev) => !prev)}
    />
  );
});

export default AgentBuilderToggle;
