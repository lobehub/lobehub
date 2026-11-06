import { Flexbox, Tag } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';

import { type SemanticSearchChunk } from '@/types/chunk';

const styles = stylex.create({
  container: {
    paddingBlock: '12px',
    paddingInline: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderRadius: '4px',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  pageNumber: {
    fontSize: '12px',
    color: cssVar.colorTextDescription,
  },
  text: {
    fontSize: '14px',
    lineHeight: '24px',
  },
  title: {
    fontSize: '18px',
  },
});

interface ChunkItemProps extends Omit<SemanticSearchChunk, 'index'> {
  index: number;
}

const SearchItem = memo<ChunkItemProps>(({ text, pageNumber, type, similarity }) => {
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
    <Flexbox className={stylex.props(styles.container, typeStyle).className} gap={8}>
      {text}

      <Flexbox horizontal align={'center'} distribution={'space-between'}>
        <Tag variant={'filled'}>{similarity.toFixed(2)}</Tag>
        <Flexbox className={stylex.props(styles.pageNumber).className}>第 {pageNumber} 页</Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default SearchItem;
