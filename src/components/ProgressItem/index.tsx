import { Flexbox } from '@lobehub/ui';
import { Progress } from 'antd';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import { type CSSProperties } from 'react';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  desc: css`
    height: 20px;
    font-size: 12px;
    line-height: 20px;
    color: ${cssVar.colorTextTertiary};
  `,
  title: css`
    font-size: 15px;
    font-weight: bold;
    color: ${cssVar.colorTextSecondary};
  `,
}));

interface ProgressItemProps {
  className?: string;
  desc?: string;
  legend?: string;
  padding?: number;
  percent: number;
  style?: CSSProperties;
  title: string;
  usage: {
    total: string | number;
    used: string | number;
  };
}

const ProgressItem = memo<ProgressItemProps>(
  ({ legend, title, desc, usage, percent, style, className }) => {
    const { mobile } = useResponsive();

    return (
      <Flexbox className={className} paddingInline={16} style={style} width={'100%'}>
        <Flexbox horizontal align={'center'} justify={'space-between'} width={'100%'}>
          <Flexbox horizontal align={'center'} gap={8}>
            {legend && (
              <Flexbox
                height={8}
                width={8}
                style={{
                  background: cssVar.geekblue,
                  borderRadius: '50%',
                  flex: 'none',
                }}
              />
            )}
            <Flexbox align={'baseline'} gap={mobile ? 0 : 8} horizontal={!mobile}>
              <div className={styles.title}>{title}</div>
              {desc && <div className={styles.desc}>{desc}</div>}
            </Flexbox>
          </Flexbox>
          <div>
            <span style={{ fontWeight: 'bold' }}>{usage.used}</span>
            {['', '/', usage.total].join(' ')}
          </div>
        </Flexbox>
        <Progress
          percent={percent}
          showInfo={false}
          size={'small'}
          strokeColor={cssVar.colorPrimary}
        />
      </Flexbox>
    );
  },
);

export default ProgressItem;
