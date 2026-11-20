'use client';

import { createStaticStyles, cssVar, cx } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';

import { externalLinkHref, truncateUrl } from './utils';

const styles = createStaticStyles(({ css }) => ({
  root: css`
    pointer-events: none;

    position: fixed;
    z-index: 1500;
    inset-block-end: 0;
    inset-inline-start: 0;

    overflow: hidden;

    max-width: 60vw;
    padding-block: 2px;
    padding-inline: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
    border-start-end-radius: ${cssVar.borderRadiusSM};

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;

    opacity: 0;
    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowTertiary};

    transition: opacity 120ms ease;
  `,
  visible: css`
    opacity: 1;
  `,
}));

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
    <div aria-hidden className={cx(styles.root, visible && styles.visible)}>
      {truncateUrl(url)}
    </div>
  );
});

LinkHoverStatus.displayName = 'LinkHoverStatus';

export default LinkHoverStatus;
