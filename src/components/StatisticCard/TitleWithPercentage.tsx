import { Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { type CSSProperties, memo } from 'react';

import { calcGrowthPercentage } from './growthPercentage';

interface TitleWithPercentageProps {
  count?: number;
  inverseColor?: boolean;
  prvCount?: number;
  title: string;
}

const TitleWithPercentage = memo<TitleWithPercentageProps>(
  ({ inverseColor, title, prvCount, count }) => {
    const percentage = calcGrowthPercentage(count || 0, prvCount || 0);

    const upStyle: CSSProperties = {
      background: cssVar.colorSuccessBg,
      borderColor: cssVar.colorSuccessBorder,
      color: cssVar.colorSuccess,
    };

    const downStyle: CSSProperties = {
      backgroundColor: cssVar.colorWarningBg,
      borderColor: cssVar.colorWarningBorder,
      color: cssVar.colorWarning,
    };

    return (
      <Flexbox
        align={'center'}
        gap={8}
        horizontal
        justify={'flex-start'}
        style={{
          overflow: 'hidden',
          position: 'inherit',
        }}
      >
        <Text
          as={'h2'}
          ellipsis={{ rows: 1, tooltip: title }}
          style={{
            fontSize: 'inherit',
            fontWeight: 'inherit',
            lineHeight: 'inherit',
            margin: 0,
            overflow: 'hidden',
          }}
        >
          {title}
        </Text>
        {count && prvCount && percentage && percentage !== 0 ? (
          <Tag
            style={{
              borderWidth: 0.5,
              ...(inverseColor
                ? percentage > 0
                  ? downStyle
                  : upStyle
                : percentage > 0
                  ? upStyle
                  : downStyle),
            }}
          >
            {percentage > 0 ? '+' : ''}
            {percentage.toFixed(1)}%
          </Tag>
        ) : null}
      </Flexbox>
    );
  },
);

export default TitleWithPercentage;
