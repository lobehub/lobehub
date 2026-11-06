'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { PropsWithChildren } from 'react';
import { memo } from 'react';

const styles = stylex.create({
  container: {
    marginBlockEnd: '8px',
    paddingBlock: '8px',
    paddingInline: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
});

const ImagePreviewHeader = memo<PropsWithChildren>(({ children }) => {
  if (!children) return null;

  return (
    <Flexbox className={stylex.props(styles.container).className} gap={8}>
      {children}
    </Flexbox>
  );
});

ImagePreviewHeader.displayName = 'ImagePreviewHeader';

export default ImagePreviewHeader;
