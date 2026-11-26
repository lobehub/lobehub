import { Center } from '@lobehub/ui';
import { Surface } from '@lobehub/ui/dashboard';
import { memo, type ReactNode } from 'react';

/** The Surface tile an Agent's picture, or a skill without one, sits on. */
const IconTile = memo<{ children: ReactNode; size: number }>(({ children, size }) => (
  <Surface
    style={{
      borderRadius: Math.round(size * 0.25),
      flex: 'none',
      height: size,
      overflow: 'hidden',
      width: size,
    }}
  >
    <Center height={'100%'} width={'100%'}>
      {children}
    </Center>
  </Surface>
));

IconTile.displayName = 'MarketplaceIconTile';

export default IconTile;
