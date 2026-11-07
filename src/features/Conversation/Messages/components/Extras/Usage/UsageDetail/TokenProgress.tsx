import { formatUsageValue } from '@lobechat/utils';
import { cssVar, Flexbox } from '@lobehub/ui';
import { memo } from 'react';

export interface TokenProgressItem {
  color: string;
  id: string;
  title: string;
  value: number;
}

interface TokenProgressProps {
  data: TokenProgressItem[];
  /** Formats each row value; defaults to the compact token count format. */
  formatValue?: (value: number) => string;
  showIcon?: boolean;
}

const TokenProgress = memo<TokenProgressProps>(
  ({ data, formatValue = formatUsageValue, showIcon }) => {
    const total = data.reduce((acc, item) => acc + item.value, 0);

    return (
      <Flexbox gap={8} style={{ position: 'relative' }} width={'100%'}>
        <Flexbox
          horizontal
          height={6}
          width={'100%'}
          style={{
            background: total === 0 ? cssVar.colorFill : undefined,
            borderRadius: 3,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {data.map((item) => (
            <Flexbox
              height={'100%'}
              key={item.id}
              style={{ background: item.color, flex: total > 0 ? item.value / total : 0 }}
            />
          ))}
        </Flexbox>
        <Flexbox>
          {data.map((item) => (
            <Flexbox horizontal align={'center'} gap={4} justify={'space-between'} key={item.id}>
              <Flexbox horizontal align={'center'} gap={4}>
                {showIcon && (
                  <div
                    style={{
                      background: item.color,
                      borderRadius: '50%',
                      flex: 'none',
                      height: 6,
                      width: 6,
                    }}
                  />
                )}
                <div style={{ color: cssVar.colorTextSecondary }}>{item.title}</div>
              </Flexbox>
              <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                {formatValue(item.value)}
              </div>
            </Flexbox>
          ))}
        </Flexbox>
      </Flexbox>
    );
  },
);

export default TokenProgress;
