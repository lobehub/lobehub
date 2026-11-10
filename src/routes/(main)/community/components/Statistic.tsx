import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { HelpCircleIcon } from 'lucide-react';
import { type CSSProperties, type ReactNode } from 'react';
import { memo } from 'react';

import { sx } from '@/styles/sx';

const styles = stylex.create({
  container: { overflow: 'hidden', minWidth: '64px' },
  number: {
    margin: '0',
    fontSize: '16px',
    fontWeight: 500,
    lineHeight: 1.4,
    textAlign: 'center',
  },
  title: {
    margin: '0',
    fontSize: '12px',
    lineHeight: 1.2,
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
  },
});

export interface StatisticProps extends Omit<FlexboxProps, 'children' | 'title'> {
  title: ReactNode;
  titleStyle?: CSSProperties;
  tooltip?: string;
  value: ReactNode;
  valuePlacement?: 'top' | 'bottom';
  valueStyle?: CSSProperties;
}

const Statistic = memo<StatisticProps>(
  ({
    className,
    valueStyle,
    titleStyle,
    valuePlacement = 'top',
    tooltip,
    title,
    value,
    ...rest
  }) => {
    const isTop = valuePlacement === 'top';
    const valueContent = (
      <Text
        className={stylex.props(styles.number).className}
        ellipsis={{ rows: 1 }}
        style={valueStyle}
      >
        {value}
      </Text>
    );
    const titleContent = (
      <Text
        className={stylex.props(styles.title).className}
        ellipsis={{ rows: 1 }}
        style={titleStyle}
      >
        {title}
        {tooltip && <Icon icon={HelpCircleIcon} style={{ marginLeft: '0.4em' }} />}
      </Text>
    );
    const content = (
      <Flexbox
        align={'center'}
        flex={1}
        justify={'center'}
        {...sx(styles.container, className)}
        {...rest}
      >
        {isTop ? (
          <>
            {valueContent}
            {titleContent}
          </>
        ) : (
          <>
            {titleContent}
            {valueContent}
          </>
        )}
      </Flexbox>
    );

    if (!tooltip) return content;

    return <Tooltip title={tooltip}>{content}</Tooltip>;
  },
);

export default Statistic;
