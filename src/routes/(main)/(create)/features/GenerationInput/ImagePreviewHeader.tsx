'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import type { PropsWithChildren } from 'react';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    margin-block-end: 8px;
    padding-block: 8px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

const ImagePreviewHeader = memo<PropsWithChildren>(({ children }) => {
  if (!children) return null;

  return (
    <Flexbox className={styles.container} gap={8}>
      {children}
    </Flexbox>
  );
});

ImagePreviewHeader.displayName = 'ImagePreviewHeader';

export default ImagePreviewHeader;
