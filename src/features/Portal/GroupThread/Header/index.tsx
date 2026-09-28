import { agentDisplayName } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Avatar, Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_AVATAR } from '@/const/meta';
import PortalHeader from '@/features/Portal/components/Header';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

import { useGroupThreadClose } from './useClose';

const Header = memo<{ onClose?: () => void }>(({ onClose }) => {
  const { t } = useTranslation('common');
  const activeThreadAgentId = useAgentGroupStore((s) => s.activeThreadAgentId);

  const agents = useSessionStore(sessionSelectors.currentGroupAgents);
  const currentAgent = agents?.find((agent) => agent.id === activeThreadAgentId);

  const close = useGroupThreadClose(onClose);

  return (
    <PortalHeader
      title={
        <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
          <Avatar
            avatar={currentAgent?.avatar || DEFAULT_AVATAR}
            background={currentAgent?.backgroundColor ?? undefined}
            shape={'square'}
            size={20}
          />
          <Text ellipsis weight={600}>
            {agentDisplayName(currentAgent, t('defaultSession'))}
          </Text>
        </Flexbox>
      }
      onClose={close}
    />
  );
});

Header.displayName = 'PortalGroupThreadHeader';

export default Header;
