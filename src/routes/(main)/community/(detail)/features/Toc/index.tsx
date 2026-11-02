'use client';

import { Anchor, type AnchorProps } from '@lobehub/ui';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';

import { SCROLL_PARENT_ID } from '@/routes/(main)/community/features/const';
import { sx } from '@/styles/sx';

import { createTOCTree } from './useToc';

const styles = stylex.create({ toc: { display: { default: null, [media.lg]: 'none' } } });

const Toc = memo<AnchorProps>(({ items, className, ...rest }) => {
  const toc = useMemo(() => createTOCTree(items as any), [items]);

  return (
    <Anchor
      {...sx(styles.toc, className)}
      getContainer={() => document.querySelector<HTMLElement>(`#${SCROLL_PARENT_ID}`)}
      items={toc}
      {...rest}
    />
  );
});

export default Toc;
