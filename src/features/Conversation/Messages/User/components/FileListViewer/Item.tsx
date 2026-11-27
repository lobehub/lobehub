import { type InterfaceDensity } from '@lobechat/types';
import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { FileLock2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { useChatStore } from '@/store/chat';
import { useDensity } from '@/styles/density';
import { type ChatFileItem } from '@/types/index';
import { formatSize } from '@/utils/format';

const FILE_ICON_SIZE = { compact: 28, loose: 32 } as const satisfies Record<
  InterfaceDensity,
  number
>;

/**
 * Tombstone card for a file the viewer lost access to (its owner switched it
 * back to private, or it was deleted). The server strips name/size/url, so
 * there is nothing to preview — render a static no-access placeholder.
 */
const InaccessibleFileItem = memo(() => {
  const { t } = useTranslation('chat');
  const { density, tokens } = useDensity();

  return (
    <Block
      horizontal
      align={'center'}
      gap={tokens.contentGap}
      paddingBlock={tokens.cardHeaderPaddingBlock}
      paddingInline={`${tokens.contentGap}px ${tokens.cardPadding}px`}
      variant={'outlined'}
    >
      <Icon icon={FileLock2Icon} size={FILE_ICON_SIZE[density]} style={{ opacity: 0.45 }} />
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

const FileItem = memo<ChatFileItem & { onClick?: () => void }>(
  ({ id, fileType, size, name, inaccessible, onClick }) => {
    const openFilePreview = useChatStore((s) => s.openFilePreview);
    const { density, tokens } = useDensity();

    if (inaccessible) return <InaccessibleFileItem />;

    return (
      <Block
        clickable
        horizontal
        align={'center'}
        gap={tokens.contentGap}
        key={id}
        paddingBlock={tokens.cardHeaderPaddingBlock}
        paddingInline={`${tokens.contentGap}px ${tokens.cardPadding}px`}
        variant={'outlined'}
        onClick={() => {
          if (onClick) onClick();
          else openFilePreview({ fileId: id });
        }}
      >
        <FileIcon fileName={name} fileType={fileType} size={FILE_ICON_SIZE[density]} />
        <Flexbox style={{ overflow: 'hidden' }}>
          <Text ellipsis>{name}</Text>
          <Text fontSize={12} type={'secondary'}>
            {formatSize(size)}
          </Text>
        </Flexbox>
      </Block>
    );
  },
);
export default FileItem;
