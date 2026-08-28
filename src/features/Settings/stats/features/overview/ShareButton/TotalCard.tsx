import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import { useIsDark } from '@/hooks/useIsDark';

interface TotalCardProps {
  count: string | number;
  title: string;
}

const TotalCard = memo<TotalCardProps>(({ title, count }) => {
  const isDarkMode = useIsDark();
  return (
    <Flexbox
      padding={12}
      style={{
        background: isDarkMode ? cssVar.colorFillTertiary : cssVar.colorFillQuaternary,
        borderRadius: cssVar.borderRadiusLG,
      }}
    >
      <div
        style={{
          fontSize: 13,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 'bold',
        }}
      >
        {count}
      </div>
    </Flexbox>
  );
});

export default TotalCard;
