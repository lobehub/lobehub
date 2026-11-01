'use client';

import { Flexbox } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { memo, useState } from 'react';

import TopicCommentButton from '@/features/TopicComment/TopicCommentButton';
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
      style={{ width: '100%' }}
      right={
        <Flexbox horizontal align={'center'} gap={4}>
          <TopicCommentButton mobile />
          <ShareButton mobile open={open} setOpen={setOpen} />
        </Flexbox>
      }
      onBackClick={() =>
        // `/agent` index redirects to `..` (mobile home / session list), preserving
        // workspace scope; the old `?session=` query was never read by the target.
        router.push('/agent', { replace: true })
      }
    />
  );
});

export default MobileHeader;
