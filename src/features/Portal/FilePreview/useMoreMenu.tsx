import { Icon } from '@lobehub/ui';
import { DownloadIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { downloadFile } from '@/utils/client/downloadFile';

import { usePreviewFileItem } from './usePreviewFileItem';

export const useFilePreviewMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const { t } = useTranslation('portal');
  const previewFileId = useChatStore(chatPortalSelectors.previewFileId);
  const { data, mutate } = usePreviewFileItem();

  if (!previewFileId) return;

  return {
    copyId: previewFileId,
    extraItems: data?.url
      ? [
          {
            icon: <Icon icon={DownloadIcon} />,
            key: 'download',
            label: t('FilePreview.actions.download'),
            onClick: () => downloadFile(data.url, data.name),
          },
        ]
      : undefined,
    refresh: mutate ? () => mutate() : undefined,
  };
};
