'use client';

import { ActionIcon } from '@lobehub/ui';
import { Share2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { withSuspense } from '@/components/withSuspense';
import { DESKTOP_HEADER_ICON_SMALL_SIZE, MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useShareModal } from '@/features/ShareModal';
import { LazySharePopover as SharePopover } from '@/features/SharePopover/lazy';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

interface ShareButtonProps {
  mobile?: boolean;
  open?: boolean;
  setOpen?: (open: boolean) => void;
}

const ShareButton = memo<ShareButtonProps>(({ mobile, setOpen, open }) => {
  const { openShareModal } = useShareModal({ open, setOpen });
  const { t } = useTranslation('common');
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const enableTopicLinkShare = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const { allowed: canShare, reason } = usePermission('edit_own_content');

  // Hide share button when no topic exists (no messages sent yet)
  if (!activeTopicId) return null;

  const iconButton = (
    <ActionIcon
      disabled={!canShare}
      icon={Share2}
      size={mobile ? MOBILE_HEADER_ICON_SIZE : DESKTOP_HEADER_ICON_SMALL_SIZE}
      title={canShare ? t('share') : reason}
      tooltipProps={{
        placement: 'bottom',
      }}
      onClick={enableTopicLinkShare || !canShare ? undefined : openShareModal}
    />
  );

  if (!canShare) return iconButton;

  return (
    <>
      {enableTopicLinkShare ? (
        <SharePopover onOpenModal={openShareModal}>{iconButton}</SharePopover>
      ) : (
        iconButton
      )}
    </>
  );
});

export default withSuspense(ShareButton);
