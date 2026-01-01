import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { type ReactNode, memo } from 'react';

const Statistic = memo<{ title: ReactNode; value: ReactNode }>(({ value, title }) => {
  return (
    <Flexbox gap={4} horizontal style={{ color: cssVar.colorTextDescription, fontSize: 12 }}>
      <span style={{ fontWeight: 'bold' }}>{value}</span>
      <span style={{ fontWeight: 'normal' }}>{title}</span>
    </Flexbox>
  );
});

export default Statistic;
