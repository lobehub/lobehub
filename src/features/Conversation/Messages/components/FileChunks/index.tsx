import { type ChatFileChunk } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { BookOpenTextIcon, ChevronDown, ChevronRight } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsDark } from '@/hooks/useIsDark';

import ChunkItem from './ChunkItem';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    cursor: pointer;

    padding-block: 8px;
    padding-inline: 12px;
    padding-inline-end: 12px;
    border-radius: 8px;

    color: ${cssVar.colorText};

    background: ${cssVar.colorFillTertiary};
  `,
  containerDark: css`
    &:hover {
      background: '';
    }
  `,
  containerLight: css`
    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  title: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    font-size: 12px;
    text-overflow: ellipsis;
  `,
}));

interface FileChunksProps {
  data: ChatFileChunk[];
}

const FileChunks = memo<FileChunksProps>(({ data }) => {
  const { t } = useTranslation('chat');
  const isDarkMode = useIsDark();

  const [showDetail, setShowDetail] = useState(false);

  return (
    <Flexbox
      className={cx(styles.container, isDarkMode ? styles.containerDark : styles.containerLight)}
      gap={16}
      width={'100%'}
      onClick={() => {
        setShowDetail(!showDetail);
      }}
    >
      <Flexbox horizontal distribution={'space-between'} flex={1}>
        <Flexbox horizontal gap={8}>
          <Icon color={cssVar.geekblue} icon={BookOpenTextIcon} /> {t('rag.referenceChunks')}
        </Flexbox>
        <Icon icon={showDetail ? ChevronDown : ChevronRight} />
      </Flexbox>
      {showDetail && (
        <Flexbox horizontal gap={8} wrap={'wrap'}>
          {data.map((item, index) => {
            return <ChunkItem index={index} key={item.id} {...item} />;
          })}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default FileChunks;
