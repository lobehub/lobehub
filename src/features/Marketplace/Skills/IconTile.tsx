import { Center } from '@lobehub/ui';
import { Surface } from '@lobehub/ui/dashboard';
import { memo, type ReactNode } from 'react';

/**
 * The Surface tile every Market row and detail header puts its icon on:
 * connectors, skills without a category, and Agents.
 */
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

IconTile.displayName = 'MarketIconTile';

export default IconTile;
