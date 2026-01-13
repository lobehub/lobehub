import { Block, Flexbox, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useEffect, useRef } from 'react';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import MCPInstallProgress from '@/features/MCP/MCPInstallProgress';
import { useToolStore } from '@/store/tool';
import { mcpStoreSelectors } from '@/store/tool/selectors';
import { type DiscoverMcpItem } from '@/types/discover';
import { MCPInstallStep } from '@/types/plugins';
import { type LobeToolType } from '@/types/tool/tool';

import Actions from './Action';

interface PluginItemProps extends DiscoverMcpItem {
  active?: boolean;
  setIdentifier: (identifier?: string) => void;
  type?: LobeToolType;
}

const Item = memo<PluginItemProps>(
  ({ name, description, icon, setIdentifier, active, identifier }) => {
    const installProgress = useToolStore(
      mcpStoreSelectors.getMCPInstallProgress(identifier),
      isEqual,
    );

    const needsConfig = installProgress?.needsConfig;
    const needsDependencies = installProgress?.step === MCPInstallStep.DEPENDENCIES_REQUIRED;

    const containerRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
      if ((!needsConfig && !needsDependencies) || !containerRef.current) return;

      containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [needsConfig, needsDependencies]);

    return (
      <Flexbox gap={0} ref={containerRef}>
        <Block
          align={'center'}
          clickable
          gap={16}
          horizontal
          justify={'space-between'}
          onClick={() => setIdentifier(identifier)}
          paddingBlock={8}
          paddingInline={12}
          style={{ position: 'relative' }}
          variant={active ? 'filled' : 'borderless'}
        >
          <Flexbox
            align={'center'}
            flex={1}
            gap={8}
            horizontal
            style={{ overflow: 'hidden', position: 'relative' }}
          >
            <PluginAvatar avatar={icon} />
            <Flexbox flex={1} gap={4} style={{ overflow: 'hidden', position: 'relative' }}>
              <Text ellipsis strong>
                {name}
              </Text>
              <Text ellipsis fontSize={12} type={'secondary'}>
                {description}
              </Text>
            </Flexbox>
          </Flexbox>
          <Actions identifier={identifier} />
        </Block>

        {!!installProgress && (
          <Flexbox paddingInline={12}>
            <MCPInstallProgress identifier={identifier} />
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default Item;
