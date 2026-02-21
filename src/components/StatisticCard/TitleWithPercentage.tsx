import { Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { type CSSProperties } from 'react';
import { memo } from 'react';

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
      color: cssVar.colorSuccess,
    };

    const downStyle: CSSProperties = {
      color: cssVar.colorWarning,
    };

    return (
      <Flexbox
        horizontal
        align={'center'}
        gap={4}
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
            variant={'borderless'}
            style={{
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
