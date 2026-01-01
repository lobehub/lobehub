import { ActionIcon } from '@lobehub/ui';
import { BotMessageSquareIcon } from 'lucide-react';
import { memo } from 'react';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';

import { useProfileStore } from '../store';

const AgentBuilderToggle = memo(() => {
  const chatPanelExpanded = useProfileStore((s) => s.chatPanelExpanded);
  const setChatPanelExpanded = useProfileStore((s) => s.setChatPanelExpanded);

  return (
    <ActionIcon
      active={chatPanelExpanded}
      aria-label="Agent Builder"
      icon={BotMessageSquareIcon}
      onClick={() => setChatPanelExpanded((prev) => !prev)}
      size={DESKTOP_HEADER_ICON_SIZE}
      title="Agent Builder"
    />
  );
});

export default AgentBuilderToggle;
