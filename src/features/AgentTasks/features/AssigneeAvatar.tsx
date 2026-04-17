import { DEFAULT_AVATAR } from '@lobechat/const';
import { Avatar } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';

import { isInboxAgentId } from '../shared/isInboxAgent';

interface AssigneeAvatarProps {
  agentId?: string | null;
  size?: number;
}

const AssigneeAvatar = memo<AssigneeAvatarProps>(({ agentId, size = 22 }) => {
  const { t } = useTranslation(['chat', 'common']);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const meta = useAgentStore((s) =>
    agentId ? agentSelectors.getAgentMetaById(agentId)(s) : undefined,
  );

  if (!agentId) return null;

  const isInbox = isInboxAgentId(agentId, inboxAgentId);
  const avatar = meta?.avatar || (isInbox ? DEFAULT_INBOX_AVATAR : DEFAULT_AVATAR);
  const title =
    meta?.title?.trim() ||
    (isInbox ? t('inbox.title', { ns: 'chat' }) : t('defaultSession', { ns: 'common' }));

  return (
    <Avatar
      avatar={avatar}
      background={meta?.backgroundColor || cssVar.colorBgContainer}
      shape={'circle'}
      size={size}
      title={title}
      variant={'outlined'}
    />
  );
});

export default AssigneeAvatar;
