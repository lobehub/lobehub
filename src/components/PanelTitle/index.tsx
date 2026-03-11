'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { type CSSProperties } from 'react';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  desc: css`
    line-height: 1.4;
    color: ${cssVar.colorTextDescription};
  `,
  header: css`
    padding-block: 24px 0;
    padding-inline: 0.75rem;
  `,
  title: css`
    margin: 0;
    font-size: 26px;
    font-weight: 600;
    line-height: 1.3;
  `,
}));

interface PanelTitleProps {
  desc?: string;
  style?: CSSProperties;
  title?: string;
}

const PanelTitle = memo(({ title, desc, style }: PanelTitleProps) => {
  return (
    <Flexbox className={styles.header} gap={4} style={style}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.desc}>{desc}</p>
    </Flexbox>
  );
});

export default PanelTitle;
