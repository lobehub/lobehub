import { DEFAULT_AVATAR } from '@lobechat/const';
import { agentDisplayName, type SidebarAgentItem } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ModelTag } from '@/components/LobeIcons';
import { useAgentStore } from '@/store/agent';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import ListItem from '../../ListItem';
import Actions from './Actions';

const AgentItem = ({ item, groupId }: { item: SidebarAgentItem; groupId?: string | null }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const activeGroupId = useAgentGroupStore((s) => s.activeGroupId);
  const loading = useChatStore(
    item.type === 'group'
      ? operationSelectors.isGroupVisiblyRunning(item.id)
      : operationSelectors.isAgentVisiblyRunning(item.id),
  );
  return (
    <ListItem
      actions={<Actions groupId={groupId} item={item} setOpen={setOpen} />}
      active={item.type === 'group' ? activeGroupId === item.id : activeAgentId === item.id}
      agentId={item.id}
      avatar={item.avatar || DEFAULT_AVATAR}
      avatarBackground={item.backgroundColor || undefined}
      date={item.updatedAt?.valueOf()}
      key={item.id}
      loading={loading}
      pin={item.pinned}
      showAction={open}
      title={agentDisplayName(item, t(item.type === 'group' ? 'untitledGroup' : 'untitledAgent'))}
      type={item.type}
      addon={
        item.type === 'agent' && item.model ? (
          <Flexbox horizontal gap={4} style={{ flexWrap: 'wrap' }}>
            <ModelTag model={item.model} />
          </Flexbox>
        ) : undefined
      }
      styles={{
        container: { gap: 12 },
        content: { gap: 6, maskImage: 'linear-gradient(90deg, black 90%, transparent)' },
      }}
    />
  );
};
export default AgentItem;
