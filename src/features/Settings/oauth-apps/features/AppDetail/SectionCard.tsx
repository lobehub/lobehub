'use client';

import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { type FC, type PropsWithChildren, type ReactNode } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
}));

interface SectionCardProps {
  extra?: ReactNode;
  title: ReactNode;
}

const SectionCard: FC<PropsWithChildren<SectionCardProps>> = ({ children, extra, title }) => (
  <Flexbox className={styles.card} gap={16}>
    <Flexbox horizontal align={'center'} justify={'space-between'} style={{ minHeight: 28 }}>
      <Text weight={500}>{title}</Text>
      {extra}
    </Flexbox>
    {children}
  </Flexbox>
);

export default SectionCard;
