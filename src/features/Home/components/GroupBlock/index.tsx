import { type FlexboxProps, type IconProps } from '@lobehub/ui';
import { Flexbox, Icon, Spin, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, Suspense, useState } from 'react';

import { sx } from '@/styles/sx';

import CountBadge from '../CountBadge';
import { homeType } from '../homeType';
import moduleStyles from './index.module.css';

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
  /**
   * The rows on screen are the local copy and a refresh is in flight: a small
   * spinner beside the count, so the user knows newer data may still arrive.
   */
  loading?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  title?: ReactNode;
}

const styles = stylex.create({
  action: {
    opacity: 0,
    transition: `opacity ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut}`,
  },
  actionVisible: {
    opacity: 1,
  },
  // The whole heading is the hit target, not just the chevron — a 14px glyph is
  // a poor thing to ask someone to aim at, and the label is already there.
  heading: {
    cursor: 'pointer',
  },
});

const GroupBlock = memo<GroupBlockProps>(
  ({
    title,
    action,
    actionAlwaysVisible,
    children,
    collapsed = false,
    count,
    icon,
    loading,
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
            className={stylex.props(onCollapsedChange && styles.heading).className}
            flex={1}
            gap={6}
            justify={'flex-start'}
            role={onCollapsedChange ? 'button' : undefined}
            style={{ overflow: 'hidden' }}
            tabIndex={onCollapsedChange ? 0 : undefined}
            onClick={onCollapsedChange ? () => onCollapsedChange(!collapsed) : undefined}
          >
            {icon && <Icon color={cssVar.colorTextDescription} icon={icon} size={16} />}
            <Text ellipsis className={stylex.props(homeType.sectionLabel).className}>
              {title}
            </Text>
            {count !== undefined && <CountBadge count={count} />}
            {loading && <Spin size="small" variant="network" />}
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
            {...sx(
              [styles.action, (isHovered || actionAlwaysVisible) && styles.actionVisible],
              moduleStyles.action,
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
