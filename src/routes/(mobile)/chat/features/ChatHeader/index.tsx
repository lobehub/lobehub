'use client';

import { ChatHeader } from '@lobehub/ui/mobile';
import { memo, useState } from 'react';

import { INBOX_SESSION_ID } from '@/const/session';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import ShareButton from '@/routes/(main)/agent/features/Conversation/Header/ShareButton';

import ChatHeaderTitle from './ChatHeaderTitle';

const MobileHeader = memo(() => {
  const router = useQueryRoute();
  const [open, setOpen] = useState(false);

  return (
    <ChatHeader
      showBackButton
      center={<ChatHeaderTitle />}
      right={<ShareButton mobile open={open} setOpen={setOpen} />}
      style={{ width: '100%' }}
      onBackClick={() =>
        router.push('/agent', { query: { session: INBOX_SESSION_ID }, replace: true })
      }
    />
  );
});

export default MobileHeader;
