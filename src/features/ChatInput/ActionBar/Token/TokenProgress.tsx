import { Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { cssVar } from 'antd-style';
import numeral from 'numeral';
import { memo } from 'react';

interface TokenProgressItem {
  color: string;
  id: string;
  title: string;
  value: number;
}

interface TokenProgressProps {
  data: TokenProgressItem[];
  showIcon?: boolean;
  showTotal?: string;
}

const format = (number: number) => numeral(number).format('0,0');

const TokenProgress = memo<TokenProgressProps>(({ data, showIcon, showTotal }) => {
  const total = data.reduce((acc, item) => acc + item.value, 0);
  return (
    <Flexbox gap={8} style={{ position: 'relative' }} width={'100%'}>
      <Flexbox
        height={6}
        horizontal
        style={{
          background: total === 0 ? cssVar.colorFill : undefined,
          borderRadius: 3,
          overflow: 'hidden',
          position: 'relative',
        }}
        width={'100%'}
      >
        {data.map((item) => (
          <Flexbox
            height={'100%'}
            key={item.id}
            style={{ background: item.color, flex: item.value }}
          />
        ))}
      </Flexbox>
      <Flexbox>
        {data.map((item) => (
          <Flexbox align={'center'} gap={4} horizontal justify={'space-between'} key={item.id}>
            <Flexbox align={'center'} gap={4} horizontal>
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
            <div style={{ fontWeight: 500 }}>{format(item.value)}</div>
          </Flexbox>
        ))}
        {showTotal && (
          <>
            <Divider style={{ marginBlock: 8 }} />
            <Flexbox align={'center'} gap={4} horizontal justify={'space-between'}>
              <div style={{ color: cssVar.colorTextSecondary }}>{showTotal}</div>
              <div style={{ fontWeight: 500 }}>{format(total)}</div>
            </Flexbox>
          </>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default TokenProgress;
