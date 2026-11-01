'use client';

import { ActionIcon } from '@lobehub/ui';
import { Share2Icon } from 'lucide-react';
import { memo, useState } from 'react';

import { DESKTOP_HEADER_ICON_SIZE, MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';

import ShareModal from './ShareModal';

const ShareButton = memo<{ mobile?: boolean }>(({ mobile }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <ActionIcon
        icon={Share2Icon}
        size={mobile ? MOBILE_HEADER_ICON_SIZE : DESKTOP_HEADER_ICON_SIZE}
        onClick={() => setOpen(true)}
      />
      <ShareModal mobile={mobile} open={open} onCancel={() => setOpen(false)} />
    </>
  );
});

export default ShareButton;
