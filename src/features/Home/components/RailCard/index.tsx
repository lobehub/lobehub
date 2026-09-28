import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

import CountBadge from '../CountBadge';
import { homeType } from '../homeType';

const styles = createStaticStyles(({ css, cssVar }) => ({
  // Frosted, not opaque: the agent standing behind the first card reads through
  // the pane as a soft silhouette instead of being clipped away.
  card: css`
    padding-block: 14px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: color-mix(in srgb, ${cssVar.colorBgContainer} 72%, transparent);
    backdrop-filter: saturate(150%) blur(12px);
  `,
  // The whole heading is the hit target, not just the chevron — a 14px glyph is
  // a poor thing to ask someone to aim at, and the label is already there.
  heading: css`
    cursor: pointer;

    min-width: 0;
    padding: 0;
    border: 0;

    text-align: start;

    background: none;

    &:hover .home-rail-card-chevron {
      color: ${cssVar.colorTextSecondary};
    }
  `,
}));

interface RailCardProps {
  action?: ReactNode;
  children: ReactNode;
  /**
   * Folds the body away, leaving the title row. Only rendered as a control when
   * `onCollapsedChange` is supplied — a card nobody can re-open must not fold.
   */
  collapsed?: boolean;
  count?: number;
  onCollapsedChange?: (collapsed: boolean) => void;
  title?: ReactNode;
}

const RailCard = memo<RailCardProps>(
  ({ action, children, collapsed = false, count, onCollapsedChange, title }) => {
    const heading = (
      <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
        <Text ellipsis className={homeType.sectionLabel}>
          {title}
        </Text>
        {count !== undefined && <CountBadge count={count} />}
        {onCollapsedChange && (
          <Icon
            className={'home-rail-card-chevron'}
            color={cssVar.colorTextQuaternary}
            icon={collapsed ? ChevronRightIcon : ChevronDownIcon}
            size={14}
          />
        )}
      </Flexbox>
    );

    return (
      <Flexbox className={styles.card} data-testid={'home-rail-card'} gap={12}>
        {title && (
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            {onCollapsedChange ? (
              <button
                aria-expanded={!collapsed}
                className={styles.heading}
                data-testid={'home-rail-card-toggle'}
                type={'button'}
                onClick={() => onCollapsedChange(!collapsed)}
              >
                {heading}
              </button>
            ) : (
              heading
            )}
            {action && (
              <Flexbox horizontal align={'center'} flex={'none'} gap={2}>
                {action}
              </Flexbox>
            )}
          </Flexbox>
        )}
        {!collapsed && children}
      </Flexbox>
    );
  },
);

export default RailCard;
