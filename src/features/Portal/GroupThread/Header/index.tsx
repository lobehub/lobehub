import { ActionIcon, Avatar, Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { t } from 'i18next';
import { XIcon } from 'lucide-react';
import { memo } from 'react';

import SidebarHeader from '@/components/SidebarHeader';
import { DEFAULT_AVATAR } from '@/const/meta';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

const Header = memo(() => {
  const togglePortal = useChatStore((s) => s.togglePortal);
  const close = () => {
    useAgentGroupStore.setState({ activeThreadAgentId: '' });
    togglePortal(false);
  };
  const activeThreadAgentId = useAgentGroupStore((s) => s.activeThreadAgentId);

  const agents = useSessionStore(sessionSelectors.currentGroupAgents);
  const currentAgent = agents?.find((agent) => agent.id === activeThreadAgentId);

  return (
    <SidebarHeader
      actions={
        <Flexbox gap={4} horizontal>
          <ActionIcon icon={XIcon} onClick={close} size={'small'} />
        </Flexbox>
      }
      paddingBlock={6}
      paddingInline={8}
      style={{
        background: cssVar.colorBgContainer,
      }}
      title={
        <Flexbox align={'center'} gap={8} horizontal>
          <Avatar
            avatar={currentAgent?.avatar || DEFAULT_AVATAR}
            background={currentAgent?.backgroundColor ?? undefined}
            shape={'square'}
            size={20}
          />
          <div style={{ fontWeight: 600 }}>
            {currentAgent?.title || t('defaultSession', { ns: 'common' })}
          </div>
        </Flexbox>
      }
    />
  );
});

export default Header;
