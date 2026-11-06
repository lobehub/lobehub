import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';

import { useFileStore } from '@/store/file';
import { type FileChunk } from '@/types/chunk';

const styles = stylex.create({
  container: {
    paddingBlock: '12px',
    paddingInline: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'dashed',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderRadius: '4px',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  text: {
    fontSize: '14px',
    lineHeight: '24px',
  },
  title: {
    fontSize: '18px',
  },
});

type ChunkItemProps = FileChunk;

const ChunkItem = memo<ChunkItemProps>(({ text, type, id }) => {
  const highlightChunks = useFileStore((s) => s.highlightChunks);

  const typeStyle = useMemo(() => {
    switch (type) {
      default: {
        return styles.text;
      }
      case 'Title': {
        return styles.title;
      }
    }
  }, [type]);

  return (
    <Flexbox
      className={stylex.props(styles.container, typeStyle).className}
      onMouseEnter={() => {
        highlightChunks([id]);
      }}
      onMouseLeave={() => {
        highlightChunks([]);
      }}
    >
      {text}
    </Flexbox>
  );
});

export default ChunkItem;
