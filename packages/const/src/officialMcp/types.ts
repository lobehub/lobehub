import type { ConnectorCategory } from '../connectorCategory';

/**
 * Vendor-hosted remote MCP servers that speak the standard MCP authorization flow.
 *
 * Each entry is plain data: connecting one creates a regular HTTP connector against
 * `url`, and OAuth entries go through discovery + DCR/CIMD on the server, so no
 * vendor-specific code is needed. Every URL was probed to answer MCP `initialize`
 * (public servers) or to advertise DCR / CIMD (OAuth servers).
 * Identifiers already owned by the LobeHub or Composio catalogs are left out.
 */
export interface OfficialMcpServerType {
  /** `oauth`: standard MCP authorization (discovery + DCR/CIMD). `none`: public server. */
  auth: 'none' | 'oauth';
  author: string;
  category: ConnectorCategory;
  description: string;
  icon: string;
  identifier: string;
  label: string;
  url: string;
}

/** A vendor's favicon, used as the app icon. */
export const favicon = (domain: string) => `https://icons.duckduckgo.com/ip3/${domain}.ico`;
