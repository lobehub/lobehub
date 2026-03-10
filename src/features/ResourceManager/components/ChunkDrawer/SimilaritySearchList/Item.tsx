import { Flexbox, Tag } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useMemo } from 'react';

import { type SemanticSearchChunk } from '@/types/chunk';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding-block: 12px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 4px;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  pageNumber: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  text: css`
    font-size: 14px;
    line-height: 24px;
  `,
  title: css`
    font-size: 18px;
  `,
}));

interface ChunkItemProps extends Omit<SemanticSearchChunk, 'index'> {
  index: number;
}

const SearchItem = memo<ChunkItemProps>(({ text, pageNumber, type, similarity }) => {
  const typeClassName = useMemo(() => {
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
    <Flexbox className={cx(styles.container, typeClassName)} gap={8}>
      {text}

      <Flexbox horizontal align={'center'} distribution={'space-between'}>
        <Tag variant={'filled'}>{similarity.toFixed(2)}</Tag>
        <Flexbox className={styles.pageNumber}>第 {pageNumber} 页</Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default SearchItem;
