import { Gamepad2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useMiniGameAvailable } from '@/features/MiniGame/useMiniGameAvailable';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';

import { useAgentId } from '../../hooks/useAgentId';
import { ChatInputAction } from '../components/ChatInputAction';

/** Opens the mini game beside the chat; hidden while it is unavailable for the agent. */
const MiniGame = memo(() => {
  const { t } = useTranslation('chat');
  const available = useMiniGameAvailable(useAgentId());
  const [isOpen, toggleMiniGame] = useChatStore((s) => [
    chatPortalSelectors.showPortal(s) &&
      chatPortalSelectors.currentViewType(s) === PortalViewType.MiniGame,
    s.toggleMiniGame,
  ]);

  if (!available) return null;

  return (
    <ChatInputAction
      active={isOpen}
      icon={Gamepad2}
      title={t(isOpen ? 'miniGame.close' : 'miniGame.open')}
      onClick={() => toggleMiniGame()}
    />
  );
});

MiniGame.displayName = 'MiniGameAction';

export default MiniGame;
