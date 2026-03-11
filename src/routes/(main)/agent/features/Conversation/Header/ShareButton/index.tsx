'use client';

import { ActionIcon } from '@lobehub/ui';
import { Share2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { withSuspense } from '@/components/withSuspense';
import { DESKTOP_HEADER_ICON_SIZE, MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useWorkspaceModal } from '@/hooks/useWorkspaceModal';
import { useChatStore } from '@/store/chat';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

const ShareModal = dynamic(() => import('@/features/ShareModal'));
const SharePopover = dynamic(() => import('@/features/SharePopover'));

interface ShareButtonProps {
  mobile?: boolean;
  open?: boolean;
  setOpen?: (open: boolean) => void;
}

const ShareButton = memo<ShareButtonProps>(({ mobile, setOpen, open }) => {
  const [isModalOpen, setIsModalOpen] = useWorkspaceModal(open, setOpen);
  const { t } = useTranslation('common');
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const enableTopicLinkShare = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  // Hide share button when no topic exists (no messages sent yet)
  if (!activeTopicId) return null;

  const iconButton = (
    <ActionIcon
      icon={Share2}
      size={mobile ? MOBILE_HEADER_ICON_SIZE : DESKTOP_HEADER_ICON_SIZE}
      title={t('share')}
      tooltipProps={{
        placement: 'bottom',
      }}
      onClick={enableTopicLinkShare ? undefined : () => setIsModalOpen(true)}
    />
  );

  return (
    <>
      {enableTopicLinkShare ? (
        <SharePopover onOpenModal={() => setIsModalOpen(true)}>{iconButton}</SharePopover>
      ) : (
        iconButton
      )}
      <ShareModal open={isModalOpen} onCancel={() => setIsModalOpen(false)} />
    </>
  );
});

export default withSuspense(ShareButton);
