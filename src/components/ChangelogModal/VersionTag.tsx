'use client';

import { Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    tag: css`
      margin: 0;
      padding-block: 4px;
      padding-inline: 12px;
      border-radius: 16px;

      color: ${cssVar.colorTextSecondary};
    `,
  };
});

const VersionTag = memo<{ range: string[] }>(({ range }) => {
  return <Tag className={styles.tag}>{range.map((v) => 'v' + v).join(' ~ ')}</Tag>;
});

export default VersionTag;
