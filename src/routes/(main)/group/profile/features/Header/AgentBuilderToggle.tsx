import { ActionIcon } from '@lobehub/ui';
import { BotMessageSquareIcon } from 'lucide-react';
import { memo } from 'react';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useGroupProfileStore } from '@/store/groupProfile';

const AgentBuilderToggle = memo(() => {
  const chatPanelExpanded = useGroupProfileStore((s) => s.chatPanelExpanded);
  const setChatPanelExpanded = useGroupProfileStore((s) => s.setChatPanelExpanded);

  return (
    <ActionIcon
      active={chatPanelExpanded}
      aria-label="Agent Builder"
      icon={BotMessageSquareIcon}
      size={DESKTOP_HEADER_ICON_SIZE}
      title="Agent Builder"
      onClick={() => setChatPanelExpanded((prev) => !prev)}
    />
  );
});

export default AgentBuilderToggle;
