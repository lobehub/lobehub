import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { FileLock2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { useChatStore } from '@/store/chat';
import { type ChatFileItem } from '@/types/index';
import { formatSize } from '@/utils/format';

/**
 * Tombstone card for a file the viewer lost access to (its owner switched it
 * back to private, or it was deleted). The server strips name/size/url, so
 * there is nothing to preview — render a static no-access placeholder.
 */
const InaccessibleFileItem = memo(() => {
  const { t } = useTranslation('chat');

  return (
    <Block
      horizontal
      align={'center'}
      gap={12}
      paddingBlock={8}
      paddingInline={'12px 16px'}
      variant={'outlined'}
    >
      <Icon icon={FileLock2Icon} size={32} style={{ opacity: 0.45 }} />
      <Flexbox style={{ overflow: 'hidden' }}>
        <Text ellipsis type={'secondary'}>
          {t('inaccessibleFile.name')}
        </Text>
        <Text fontSize={12} type={'secondary'}>
          {t('inaccessibleFile.desc')}
        </Text>
      </Flexbox>
    </Block>
  );
});

const FileItem = memo<ChatFileItem>(({ id, fileType, size, name, inaccessible }) => {
  const openFilePreview = useChatStore((s) => s.openFilePreview);

  if (inaccessible) return <InaccessibleFileItem />;

  return (
    <Block
      clickable
      horizontal
      align={'center'}
      gap={12}
      key={id}
      paddingBlock={8}
      paddingInline={'12px 16px'}
      variant={'outlined'}
      onClick={() => {
        openFilePreview({ fileId: id });
      }}
    >
      <FileIcon fileName={name} fileType={fileType} size={32} />
      <Flexbox style={{ overflow: 'hidden' }}>
        <Text ellipsis>{name}</Text>
        <Text fontSize={12} type={'secondary'}>
          {formatSize(size)}
        </Text>
      </Flexbox>
    </Block>
  );
});
export default FileItem;
