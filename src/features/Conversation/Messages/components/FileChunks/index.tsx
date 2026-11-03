import { type ChatFileChunk } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BookOpenTextIcon, ChevronDown, ChevronRight } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsDark } from '@/hooks/useIsDark';

import ChunkItem from './ChunkItem';

const styles = stylex.create({
  container: {
    cursor: 'pointer',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: '8px',
    color: cssVar.colorText,
  },
  containerDark: {
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  containerLight: {
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillSecondary },
    backgroundImage: 'none',
  },
});

interface FileChunksProps {
  data: ChatFileChunk[];
}

const FileChunks = memo<FileChunksProps>(({ data }) => {
  const { t } = useTranslation('chat');
  const isDarkMode = useIsDark();

  const [showDetail, setShowDetail] = useState(false);

  return (
    <Flexbox
      gap={16}
      width={'100%'}
      className={
        stylex.props(styles.container, isDarkMode ? styles.containerDark : styles.containerLight)
          .className
      }
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
