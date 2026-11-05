// oxlint-disable-next-line stylex-migration/no-plain-css -- the pre is Shiki HTML that Highlighter injects with dangerouslySetInnerHTML, which no prop reaches
import './index.css';

import { type ConnectionConfig } from '@lobehub/market-types';
import { Block, cx, Highlighter } from '@lobehub/ui';
import { memo } from 'react';

import { genServerConfig } from '@/features/MCP/utils';

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
        className={cx(lite && 'lobe-platform-65cd1ddc-lite')}
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
