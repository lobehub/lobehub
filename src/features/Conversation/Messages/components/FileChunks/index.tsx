import { type ChatFileChunk, type InterfaceDensity } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BookOpenTextIcon, ChevronDown, ChevronRight } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsDark } from '@/hooks/useIsDark';
import { useDensity } from '@/styles/density';
import { densityTokens } from '@/styles/density.stylex';

import ChunkItem from './ChunkItem';

const PADDING_BLOCK = { compact: 4, loose: 8 } as const satisfies Record<InterfaceDensity, number>;

const styles = stylex.create({
  container: {
    cursor: 'pointer',
    paddingBlock: `${PADDING_BLOCK.loose}px`,
    paddingInline: densityTokens['--lobe-density-content-gap'],
    borderRadius: densityTokens['--lobe-density-radius'],
    color: cssVar.colorText,
  },
  containerCompact: {
    paddingBlock: `${PADDING_BLOCK.compact}px`,
    fontSize: densityTokens['--lobe-density-font-size'],
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
  const { compact } = useDensity();

  const [showDetail, setShowDetail] = useState(false);

  return (
    <Flexbox
      gap={16}
      width={'100%'}
      className={
        stylex.props(
          styles.container,
          compact && styles.containerCompact,
          isDarkMode ? styles.containerDark : styles.containerLight,
        ).className
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
