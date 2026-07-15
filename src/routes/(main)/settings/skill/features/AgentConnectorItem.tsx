'use client';

import { Tag } from '@lobehub/ui';
import { McpIcon } from '@lobehub/ui/icons';
import { memo } from 'react';

import NavItem from '@/features/NavPanel/components/NavItem';
import type { AgentBoundConnector } from '@/store/tool/slices/connector/types';

/**
 * A row in the unified settings' "Agent Connectors" section (LOBE-11682).
 *
 * Rendered identically to the base custom-connector rows (same NavItem + MCP
 * icon), so the only visual difference is a tag naming the owning agent. It is
 * selectable — clicking routes to the shared ConnectorDetail on the right (tool
 * permissions / delete / sync), keyed by connector id to avoid the
 * identifier collision an agent connector can have with a base one.
 */
const AgentConnectorItem = memo<{
  connector: AgentBoundConnector;
  isSelected?: boolean;
  onSelect?: () => void;
}>(({ connector, isSelected, onSelect }) => (
  <NavItem
    active={isSelected}
    extra={connector.agentTitle ? <Tag size="small">{connector.agentTitle}</Tag> : undefined}
    icon={McpIcon}
    title={connector.name || connector.identifier}
    onClick={onSelect}
  />
));

AgentConnectorItem.displayName = 'AgentConnectorItem';

export default AgentConnectorItem;
