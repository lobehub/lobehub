'use client';

import { Tag } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const styles = stylex.create({
  tag: {
    margin: '0',
    paddingBlock: '4px',
    paddingInline: '12px',
    borderRadius: '16px',
    color: cssVar.colorTextSecondary,
  },
});

const VersionTag = memo<{ range: string[] }>(({ range }) => {
  return (
    <Tag className={stylex.props(styles.tag).className}>
      {range.map((v) => 'v' + v).join(' ~ ')}
    </Tag>
  );
});

export default VersionTag;
