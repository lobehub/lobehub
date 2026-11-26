import { AGENT_CHAT_URL } from '@lobechat/const';
import { agentDisplayName, agentRenameField } from '@lobechat/types';

import { openRenameModal } from '@/components/RenameModal';
import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { usePrivateAgentLinkNotice } from '@/features/PrivateAgentLinkNotice';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import { usePortalShareUrl } from '../components/PortalMoreMenu/shareUrl';

export const useAgentDetailMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const agentId = useChatStore(chatPortalSelectors.agentDetailId);
  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId || ''));
  const [updateAgentMetaById, refreshAgentConfig] = useAgentStore((s) => [
    s.updateAgentMetaById,
    s.internal_refreshAgentConfig,
  ]);
  const { allowed: canEdit } = usePermission('edit_own_content');
  const shareUrl = usePortalShareUrl(agentId ? AGENT_CHAT_URL(agentId) : undefined);
  const notifyPrivateAgentLink = usePrivateAgentLinkNotice();

  if (!agentId) return;

  return {
    copyId: agentId,
    copyLink: shareUrl,
    // A private agent's link opens for nobody else in the workspace.
    onLinkCopied: () => notifyPrivateAgentLink(agentId),
    refresh: () => refreshAgentConfig(agentId),
    rename: canEdit
      ? () =>
          openRenameModal({
            defaultValue: agentDisplayName(meta, ''),
            onSave: (next) => updateAgentMetaById(agentId, { [agentRenameField(meta)]: next }),
          })
      : undefined,
  };
};
