import { Flexbox, Text } from '@lobehub/ui';
import { Surface } from '@lobehub/ui/dashboard';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';

const styles = stylex.create({
  body: (gap: number) => ({
    display: 'flex',
    flexDirection: 'column',
    gap,
    minWidth: 0,
    padding: 16,
  }),
});

/** Every content block on an app's page: a Surface card. */
export const MarketCard = memo<{ children: ReactNode; gap?: number }>(({ children, gap = 12 }) => (
  <Surface>
    <div {...stylex.props(styles.body(gap))}>{children}</div>
  </Surface>
));

MarketCard.displayName = 'MarketplaceCard';

/** A titled card: the label above, the content in the Surface. */
export const CardSection = ({
  children,
  extra,
  title,
}: {
  children: ReactNode;
  extra?: ReactNode;
  title: ReactNode;
}) => (
  <Flexbox gap={8}>
    <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
      <Text weight={600}>{title}</Text>
      {extra}
    </Flexbox>
    <MarketCard>{children}</MarketCard>
  </Flexbox>
);
