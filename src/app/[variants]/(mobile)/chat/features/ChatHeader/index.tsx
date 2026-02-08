'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { Settings } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import ShareButton from '@/app/[variants]/(main)/agent/features/Conversation/Header/ShareButton';
import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { INBOX_SESSION_ID } from '@/const/session';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentStore } from '@/store/agent';

import ChatHeaderTitle from './ChatHeaderTitle';

const MobileHeader = memo(() => {
  const router = useQueryRoute();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const { t } = useTranslation('common');

  const handleOpenSettings = () => {
    if (activeAgentId) {
      navigate(`/agent/${activeAgentId}/settings`);
    }
  };

  return (
    <ChatHeader
      center={<ChatHeaderTitle />}
      onBackClick={() =>
        router.push('/agent', { query: { session: INBOX_SESSION_ID }, replace: true })
      }
      right={
        <Flexbox gap={4} horizontal>
          <ActionIcon
            icon={Settings}
            onClick={handleOpenSettings}
            size={MOBILE_HEADER_ICON_SIZE}
            title={t('setting')}
          />
          <ShareButton mobile open={open} setOpen={setOpen} />
        </Flexbox>
      }
      showBackButton
      style={{ width: '100%' }}
    />
  );
});

export default MobileHeader;
