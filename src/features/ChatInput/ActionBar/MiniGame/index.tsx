import { Gamepad2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import { useAgentId } from '../../hooks/useAgentId';
import { ChatInputAction } from '../components/ChatInputAction';

/**
 * Opens the mini game beside the chat. Hidden unless the `mini_game` flag is
 * on, and for heterogeneous agents (Claude Code, Codex…): their runtime has no
 * game tool, so they could read the snapshot but never move the character.
 */
const MiniGame = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const flagEnabled = useServerConfigStore(serverConfigSelectors.enableMiniGame);
  const isHeterogeneous = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
  const [isOpen, toggleMiniGame] = useChatStore((s) => [
    chatPortalSelectors.showPortal(s) &&
      chatPortalSelectors.currentViewType(s) === PortalViewType.MiniGame,
    s.toggleMiniGame,
  ]);

  if (!flagEnabled || isHeterogeneous) return null;

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
