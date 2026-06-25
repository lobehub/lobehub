'use client';

import { ChatHeader } from '@lobehub/ui/mobile';
import { memo, useState } from 'react';

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
        // `/agent` index redirects to `..` (mobile home / session list), preserving
        // workspace scope; the old `?session=` query was never read by the target.
        router.push('/agent', { replace: true })
      }
    />
  );
});

export default MobileHeader;
