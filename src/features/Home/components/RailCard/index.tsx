import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
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
}));

interface RailCardProps {
  action?: ReactNode;
  children: ReactNode;
  count?: number;
  title?: ReactNode;
}

const RailCard = memo<RailCardProps>(({ action, children, count, title }) => (
  <Flexbox className={styles.card} data-testid={'home-rail-card'} gap={12}>
    {title && (
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
          <Text ellipsis className={homeType.sectionLabel}>
            {title}
          </Text>
          {count !== undefined && <CountBadge count={count} />}
        </Flexbox>
        {action && (
          <Flexbox horizontal align={'center'} flex={'none'} gap={2}>
            {action}
          </Flexbox>
        )}
      </Flexbox>
    )}
    {children}
  </Flexbox>
));

export default RailCard;
