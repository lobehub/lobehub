import { type FlexboxProps, type IconProps } from '@lobehub/ui';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type ReactNode } from 'react';
import { memo, Suspense, useState } from 'react';

import CountBadge from '../CountBadge';
import { homeType } from '../homeType';

interface GroupBlockProps extends Omit<FlexboxProps, 'title'> {
  action?: ReactNode;
  actionAlwaysVisible?: boolean;
  count?: number;
  icon?: IconProps['icon'];
  title?: ReactNode;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  action: css`
    opacity: 0;
    transition: opacity ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};

    button {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  actionVisible: css`
    opacity: 1;
  `,
}));

const GroupBlock = memo<GroupBlockProps>(
  ({ title, action, actionAlwaysVisible, children, count, icon, ...rest }) => {
    const [isHovered, setIsHovered] = useState(false);

    return (
      <Flexbox
        gap={12}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        {...rest}
      >
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Flexbox
            horizontal
            align={'center'}
            flex={1}
            gap={6}
            justify={'flex-start'}
            style={{ overflow: 'hidden' }}
          >
            {icon && <Icon color={cssVar.colorTextDescription} icon={icon} size={16} />}
            <Text ellipsis className={homeType.sectionLabel}>
              {title}
            </Text>
            {count !== undefined && <CountBadge count={count} />}
          </Flexbox>
          <Flexbox
            horizontal
            align={'center'}
            flex={'none'}
            gap={2}
            justify={'flex-end'}
            className={cx(
              styles.action,
              (isHovered || actionAlwaysVisible) && styles.actionVisible,
            )}
          >
            {action}
          </Flexbox>
        </Flexbox>
        <Suspense fallback={'loading'}>{children}</Suspense>
      </Flexbox>
    );
  },
);

export default GroupBlock;
