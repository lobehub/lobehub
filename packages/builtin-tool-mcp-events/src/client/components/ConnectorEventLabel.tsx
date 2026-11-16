'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import ConnectorBrandIcon from '@/features/Connectors/ConnectorBrandIcon';
import { useConnectorDisplay } from '@/features/Connectors/useConnectorDisplay';

const styles = stylex.create({
  event: { fontFamily: cssVar.fontFamilyCode, fontSize: '13px' },
  separator: { flex: 'none', color: cssVar.colorTextQuaternary },
});

interface ConnectorEventLabelProps {
  /** The event type, in code font: it is the server's identifier, not prose. */
  event?: string;
  fallbackName?: string;
  identifier: string;
  size?: number;
}

/** `[mark] Connector · event.name` — how a subscription's source is named in the conversation. */
const ConnectorEventLabel = memo<ConnectorEventLabelProps>(
  ({ event, fallbackName, identifier, size = 16 }) => {
    const connector = useConnectorDisplay(identifier, fallbackName);

    return (
      <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
        <ConnectorBrandIcon
          avatar={connector.avatar}
          identifier={connector.identifier}
          name={connector.name}
          size={size}
          sourceType={connector.sourceType}
        />
        <Text ellipsis style={{ flex: 'none', maxWidth: '50%' }} weight={500}>
          {connector.name}
        </Text>
        {event && (
          <>
            <span {...stylex.props(styles.separator)}>·</span>
            <Text ellipsis className={stylex.props(styles.event).className}>
              {event}
            </Text>
          </>
        )}
      </Flexbox>
    );
  },
);

ConnectorEventLabel.displayName = 'McpEventsConnectorEventLabel';

export default ConnectorEventLabel;
