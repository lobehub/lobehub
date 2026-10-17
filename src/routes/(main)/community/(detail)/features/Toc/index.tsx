'use client';

import { Anchor, type AnchorProps } from '@lobehub/ui';
import { createStaticStyles, cx, responsive } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import { SCROLL_PARENT_ID } from '@/routes/(main)/community/features/const';

import { createTOCTree } from './useToc';

const styles = createStaticStyles(({ css }) => ({
  toc: css`
    ${responsive.lg} {
      display: none;
    }
  `,
}));

const Toc = memo<AnchorProps>(({ items, className, ...rest }) => {
  const toc = useMemo(() => createTOCTree(items as any), [items]);

  return (
    <Anchor
      className={cx(className, styles.toc)}
      getContainer={() => document.querySelector<HTMLElement>(`#${SCROLL_PARENT_ID}`)}
      items={toc}
      {...rest}
    />
  );
});

export default Toc;
