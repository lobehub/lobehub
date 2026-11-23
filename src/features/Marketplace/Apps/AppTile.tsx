import { Center } from '@lobehub/ui';
import { Surface } from '@lobehub/ui/dashboard';
import { memo } from 'react';

import { AppIcon } from './AppIcon';
import type { MarketplaceApp } from './catalog';

/** The app's logo on a Surface tile, like an app icon: catalog rows use 40, the detail header 56. */
const AppTile = memo<{ app: MarketplaceApp; size: number }>(({ app, size }) => (
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
      <AppIcon app={app} size={Math.round(size * 0.6)} />
    </Center>
  </Surface>
));

AppTile.displayName = 'MarketplaceAppTile';

export default AppTile;
