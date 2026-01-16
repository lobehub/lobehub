import { ActionIcon, Avatar, Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { t } from 'i18next';
import { XIcon } from 'lucide-react';
import { memo } from 'react';

import { DEFAULT_AVATAR } from '@/const/meta';
import NavHeader from '@/features/NavHeader';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

const Header = memo(() => {
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);
  const close = () => {
    useAgentGroupStore.setState({ activeThreadAgentId: '' });
    clearPortalStack();
  };
  const activeThreadAgentId = useAgentGroupStore((s) => s.activeThreadAgentId);

  const agents = useSessionStore(sessionSelectors.currentGroupAgents);
  const currentAgent = agents?.find((agent) => agent.id === activeThreadAgentId);

  return (
    <NavHeader
      left={
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
      paddingBlock={6}
      paddingInline={8}
      right={
        <Flexbox gap={4} horizontal>
          <ActionIcon icon={XIcon} onClick={close} size={'small'} />
        </Flexbox>
      }
      showTogglePanelButton={false}
      style={{
        background: cssVar.colorBgContainer,
      }}
    />
  );
});

export default Header;
