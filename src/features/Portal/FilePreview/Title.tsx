import { DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Skeleton, Text } from '@lobehub/ui/base-ui';
import { ArrowLeft, DownloadIcon, MoreHorizontalIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useFileStore } from '@/store/file';
import { oneLineEllipsis } from '@/styles';
import { downloadFile } from '@/utils/client/downloadFile';

const Title = () => {
  const { t } = useTranslation('portal');
  const [closeFilePreview, previewFileId] = useChatStore((s) => [
    s.closeFilePreview,
    chatPortalSelectors.previewFileId(s),
  ]);

  const useFetchFileItem = useFileStore((s) => s.useFetchKnowledgeItem);

  const { data, isLoading } = useFetchFileItem(previewFileId);

  const dropdownItems = useMemo(
    () =>
      data?.url
        ? [
            {
              icon: <Icon icon={DownloadIcon} />,
              key: 'download',
              label: t('FilePreview.actions.download'),
              onClick: () => downloadFile(data.url, data.name),
            },
          ]
        : [],
    [data?.url, data?.name, t],
  );

  return (
    <Flexbox horizontal align={'center'} gap={4} justify={'space-between'}>
      <Flexbox horizontal align={'center'} gap={4} style={{ overflow: 'hidden' }}>
        <ActionIcon icon={ArrowLeft} size={'small'} onClick={() => closeFilePreview()} />

        {isLoading ? (
          <Skeleton height={28} />
        ) : (
          <Text className={oneLineEllipsis} style={{ fontSize: 16 }} type={'secondary'}>
            {data?.name}
          </Text>
        )}
      </Flexbox>

      {dropdownItems.length > 0 && (
        <DropdownMenu items={dropdownItems}>
          <ActionIcon icon={MoreHorizontalIcon} size={'small'} />
        </DropdownMenu>
      )}
    </Flexbox>
  );
};

export default Title;
