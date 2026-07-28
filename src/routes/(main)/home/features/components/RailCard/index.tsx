import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, type ReactNode } from 'react';

import CountBadge from '../CountBadge';

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
  title: css`
    font-size: 13px;
    font-weight: 600;
    line-height: 18px;
  `,
}));

interface RailCardProps {
  action?: ReactNode;
  children: ReactNode;
  count?: number;
  title?: ReactNode;
}

const RailCard = memo<RailCardProps>(({ action, children, count, title }) => (
  <Flexbox className={styles.card} gap={12}>
    {title && (
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
          <Text ellipsis className={styles.title}>
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
