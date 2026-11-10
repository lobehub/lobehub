'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type FC, type PropsWithChildren, type ReactNode } from 'react';

const styles = stylex.create({
  card: {
    padding: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

interface SectionCardProps {
  extra?: ReactNode;
  title: ReactNode;
}

const SectionCard: FC<PropsWithChildren<SectionCardProps>> = ({ children, extra, title }) => (
  <Flexbox className={stylex.props(styles.card).className} gap={16}>
    <Flexbox horizontal align={'center'} justify={'space-between'} style={{ minHeight: 28 }}>
      <Text weight={500}>{title}</Text>
      {extra}
    </Flexbox>
    {children}
  </Flexbox>
);

export default SectionCard;
