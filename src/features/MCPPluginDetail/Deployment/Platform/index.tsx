import { type ConnectionConfig } from '@lobehub/market-types';
import { Block, cx, Highlighter } from '@lobehub/ui';
import { memo } from 'react';

import { genServerConfig } from '@/features/MCP/utils';

import styles from './index.module.css';

interface PlatformProps {
  connection?: ConnectionConfig;
  identifier?: string;
  lite?: boolean;
  mobile?: boolean;
}

const Platform = memo<PlatformProps>(({ lite, identifier, connection }) => {
  const serverConfig = genServerConfig(identifier, connection);

  return (
    <Block gap={lite ? 0 : 16} padding={4} variant={lite ? 'outlined' : 'borderless'}>
      <Highlighter
        fullFeatured
        className={cx(lite && styles.lite)}
        fileName={'MCP server config'}
        language={'json'}
        variant={'filled'}
        style={{
          fontSize: 12,
        }}
      >
        {serverConfig}
      </Highlighter>
    </Block>
  );
});

export default Platform;
