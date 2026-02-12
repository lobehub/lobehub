import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { type ReactNode } from 'react';
import { memo } from 'react';

const Statistic = memo<{ title: ReactNode; value: ReactNode }>(({ value, title }) => {
  return (
    <Flexbox horizontal gap={4} style={{ color: cssVar.colorTextDescription, fontSize: 12 }}>
      <span style={{ fontWeight: 'bold' }}>{value}</span>
      <span style={{ fontWeight: 'normal' }}>{title}</span>
    </Flexbox>
  );
});

export default Statistic;
