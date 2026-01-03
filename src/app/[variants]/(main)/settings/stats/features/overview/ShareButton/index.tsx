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
        onClick={() => setOpen(true)}
        size={mobile ? MOBILE_HEADER_ICON_SIZE : DESKTOP_HEADER_ICON_SIZE}
      />
      <ShareModal mobile={mobile} onCancel={() => setOpen(false)} open={open} />
    </>
  );
});

export default ShareButton;
