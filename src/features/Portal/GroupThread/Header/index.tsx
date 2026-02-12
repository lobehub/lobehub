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
      paddingBlock={6}
      paddingInline={8}
      showTogglePanelButton={false}
      left={
        <Flexbox horizontal align={'center'} gap={8}>
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
      right={
        <Flexbox horizontal gap={4}>
          <ActionIcon icon={XIcon} size={'small'} onClick={close} />
        </Flexbox>
      }
      style={{
        background: cssVar.colorBgContainer,
      }}
    />
  );
});

export default Header;
