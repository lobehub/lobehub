'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useEffect, useState } from 'react';

import { externalLinkHref, truncateUrl } from './utils';

const styles = stylex.create({
  root: {
    pointerEvents: 'none',
    position: 'fixed',
    zIndex: 1500,
    insetBlockEnd: '0',
    insetInlineStart: '0',
    overflow: 'hidden',
    maxWidth: '60vw',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderInlineEndWidth: '1px',
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: cssVar.colorBorderSecondary,
    borderStartEndRadius: cssVar.borderRadiusSM,
    fontSize: '12px',
    lineHeight: '18px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    opacity: 0,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowTertiary,
    transition: 'opacity 120ms ease',
  },
  visible: { opacity: 1 },
});

const LinkHoverStatus = memo(() => {
  const [url, setUrl] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onOver = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest('a[href]');
      const next = externalLinkHref(anchor?.getAttribute('href'));
      if (next) {
        setUrl(next);
        setVisible(true);
      } else {
        setVisible(false);
      }
    };
    const onLeave = () => setVisible(false);
    document.addEventListener('mouseover', onOver);
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.documentElement.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <div aria-hidden {...stylex.props(styles.root, visible && styles.visible)}>
      {truncateUrl(url)}
    </div>
  );
});

LinkHoverStatus.displayName = 'LinkHoverStatus';

export default LinkHoverStatus;
