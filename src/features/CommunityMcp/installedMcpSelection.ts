import { encodeMobileSelection } from '@/features/Settings/skill/mobileSelection';
import type { LobeToolType } from '@/types/tool/tool';

/**
 * The `open` value that shows an installed MCP's settings.
 *
 * A marketplace install writes a connector and no plugin row, and a custom MCP
 * is a connector too, so both open as `mcp-connector`. Only a legacy marketplace
 * plugin row opens as `plugin`: that detail first projects the row into a
 * connector (`connector.syncPluginTools`), which fails when there is no row.
 *
 * @param legacyType the type of the installed plugin row, when one exists
 */
export const installedMcpSelection = (identifier: string, legacyType?: LobeToolType) =>
  encodeMobileSelection({
    identifier,
    type: legacyType === 'plugin' ? 'plugin' : 'mcp-connector',
  });
