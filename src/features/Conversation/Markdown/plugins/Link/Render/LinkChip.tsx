'use client';

import { createStaticStyles } from 'antd-style';
import { memo, type ReactNode } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    color: ${cssVar.colorLink};
    text-decoration: none;
    transition: color 0.15s;

    &:hover {
      color: ${cssVar.colorLinkHover};
    }
  `,
  icon: css`
    display: inline-flex;
    margin-inline-end: 4px;
    vertical-align: -0.15em;
  `,
}));

interface LinkChipProps {
  href?: string;
  icon?: ReactNode;
  label: string;
}

const LinkChip = memo<LinkChipProps>(({ href, icon, label }) => (
  <a className={styles.chip} href={href} rel="noopener noreferrer" target="_blank">
    {icon && <span className={styles.icon}>{icon}</span>}
    {label}
  </a>
));

LinkChip.displayName = 'LinkChip';

export default LinkChip;
