import { type FlexboxProps, type IconProps } from '@lobehub/ui';
import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, Suspense, useState } from 'react';

import CountBadge from '../CountBadge';
import { homeType } from '../homeType';

interface GroupBlockProps extends Omit<FlexboxProps, 'title'> {
  action?: ReactNode;
  actionAlwaysVisible?: boolean;
  /**
   * Folds the body away, leaving the title row. Only rendered as a control when
   * `onCollapsedChange` is supplied — a block nobody can re-open must not fold.
   */
  collapsed?: boolean;
  count?: number;
  icon?: IconProps['icon'];
  onCollapsedChange?: (collapsed: boolean) => void;
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
  // The whole heading is the hit target, not just the chevron — a 14px glyph is
  // a poor thing to ask someone to aim at, and the label is already there.
  heading: css`
    cursor: pointer;
  `,
}));

const GroupBlock = memo<GroupBlockProps>(
  ({
    title,
    action,
    actionAlwaysVisible,
    children,
    collapsed = false,
    count,
    icon,
    onCollapsedChange,
    ...rest
  }) => {
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
            aria-expanded={onCollapsedChange ? !collapsed : undefined}
            className={cx(onCollapsedChange && styles.heading)}
            flex={1}
            gap={6}
            justify={'flex-start'}
            role={onCollapsedChange ? 'button' : undefined}
            style={{ overflow: 'hidden' }}
            tabIndex={onCollapsedChange ? 0 : undefined}
            onClick={onCollapsedChange ? () => onCollapsedChange(!collapsed) : undefined}
          >
            {icon && <Icon color={cssVar.colorTextDescription} icon={icon} size={16} />}
            <Text ellipsis className={homeType.sectionLabel}>
              {title}
            </Text>
            {count !== undefined && <CountBadge count={count} />}
            {onCollapsedChange && (
              <Icon
                color={cssVar.colorTextQuaternary}
                icon={collapsed ? ChevronRightIcon : ChevronDownIcon}
                size={14}
              />
            )}
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
        {!collapsed && <Suspense fallback={'loading'}>{children}</Suspense>}
      </Flexbox>
    );
  },
);

export default GroupBlock;
