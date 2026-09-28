import { Icon } from '@lobehub/ui';
import { DownloadIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useFileStore } from '@/store/file';
import { downloadFile } from '@/utils/client/downloadFile';

export const useFilePreviewMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const { t } = useTranslation('portal');
  const previewFileId = useChatStore(chatPortalSelectors.previewFileId);
  const useFetchFileItem = useFileStore((s) => s.useFetchKnowledgeItem);
  // Same SWR key as the title and body, so this shares their request.
  const { data, mutate } = useFetchFileItem(previewFileId);

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
    refresh: () => mutate(),
  };
};
