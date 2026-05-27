'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { MessageSquarePlus } from 'lucide-react';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

import { ProductLogo } from '@/components/Branding';
import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { SESSION_CHAT_URL } from '@/const/url';
import UserAvatar from '@/features/User/UserAvatar';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

import { styles } from './SessionHeader/style';

const Header = memo(() => {
  const createAgent = useAgentStore((s) => s.createAgent);
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const navigate = useNavigate();
  const router = useQueryRoute();

  const handleCreateAgent = async () => {
    const result = await createAgent({});
    await refreshAgentList();
    router.push(SESSION_CHAT_URL(result.agentId, true));
  };

  return (
    <ChatHeader
      style={mobileHeaderSticky}
      left={
        <Flexbox horizontal align={'center'} className={styles.leftContainer} gap={8}>
          <UserAvatar size={32} onClick={() => navigate('/me')} />
          <ProductLogo type={'text'} />
        </Flexbox>
      }
      right={
        <ActionIcon
          icon={MessageSquarePlus}
          size={MOBILE_HEADER_ICON_SIZE}
          onClick={handleCreateAgent}
        />
      }
    />
  );
});

export default Header;
