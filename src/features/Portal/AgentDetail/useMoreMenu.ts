import { AGENT_CHAT_URL } from '@lobechat/const';
import { agentDisplayName, type AgentNameFields } from '@lobechat/types';

import { openRenameModal } from '@/components/RenameModal';
import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import { usePortalShareUrl } from '../components/PortalMoreMenu/shareUrl';

/**
 * The field a rename writes: whichever one the header is showing. `name` wins
 * the label whenever it is set, so renaming `title` under a named agent would
 * save without visibly changing anything.
 */
export const agentRenameField = (meta: AgentNameFields): 'name' | 'title' =>
  meta.name?.trim() ? 'name' : 'title';

export const useAgentDetailMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const agentId = useChatStore(chatPortalSelectors.agentDetailId);
  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId || ''));
  const [updateAgentMetaById, refreshAgentConfig] = useAgentStore((s) => [
    s.updateAgentMetaById,
    s.internal_refreshAgentConfig,
  ]);
  const { allowed: canEdit } = usePermission('edit_own_content');
  const shareUrl = usePortalShareUrl(agentId ? AGENT_CHAT_URL(agentId) : undefined);

  if (!agentId) return;

  return {
    copyId: agentId,
    copyLink: shareUrl,
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
