'use client';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { Maximize2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import PortalChromeHeader from '@/features/Portal/components/Header';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import Title from './Title';

const Header = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useChatStore(chatPortalSelectors.agentDetailId);
  const navigate = useWorkspaceAwareNavigate();
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);

  return (
    <PortalChromeHeader
      title={<Title />}
      rightExtra={
        agentId ? (
          <ActionIcon
            icon={Maximize2Icon}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('internalLink.agent.open')}
            onClick={() => {
              navigate(`/agent/${agentId}`);
              clearPortalStack();
            }}
          />
        ) : undefined
      }
    />
  );
});

export default Header;
