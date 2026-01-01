import { Flexbox } from '@lobehub/ui';
import { cssVar, useThemeMode } from 'antd-style';
import { memo } from 'react';

interface TotalCardProps {
  count: string | number;
  title: string;
}

const TotalCard = memo<TotalCardProps>(({ title, count }) => {
  const { isDarkMode } = useThemeMode();
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
