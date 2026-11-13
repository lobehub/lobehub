import {
  encodeMobileSelection,
  MOBILE_SELECTION_PARAM,
} from '@/features/Settings/skill/mobileSelection';

export interface ConnectorRef {
  /** Set when an agent owns the connector rather than the user. */
  agentId?: string | null;
  identifier: string;
}

const CONNECTOR_SETTINGS = '/settings/connector';

/**
 * Where to send the user to fix a connector: straight to its detail on the
 * Connectors page, through the page's own `?open=<type>:<id>` selection (the
 * same one a row click writes), so the broken connector is on screen rather
 * than somewhere below the built-in tools.
 *
 * Only a user connector opens its detail directly — the detail loads that
 * connector itself. An agent-owned connector's detail reads a list only the
 * Connectors list loads, so a cold deep link would open it empty; those go to
 * the list, where the connector sits under Agent Connectors.
 */
export const connectorSettingsPath = (connector?: ConnectorRef | null) => {
  if (!connector?.identifier || connector.agentId) return CONNECTOR_SETTINGS;

  const params = new URLSearchParams({
    [MOBILE_SELECTION_PARAM]: encodeMobileSelection({
      identifier: connector.identifier,
      type: 'mcp-connector',
    }),
  });
  return `${CONNECTOR_SETTINGS}?${params.toString()}`;
};
