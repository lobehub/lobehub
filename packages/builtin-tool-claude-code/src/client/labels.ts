// Component-free barrel for the tool-label helpers, exported as
// `@lobechat/builtin-tool-claude-code/client/labels`.
//
// The workflow summary (`toolDisplayNames.ts`) turns wire tool names into
// human labels outside of React, so this entry must stay free of React /
// antd-style / lucide imports — pulling `client/index.ts` instead would drag
// the inspector components (and their `keyframes`-using style modules) in
// transitively.

export {
  BROWSER_MCP_PREFIX,
  BROWSER_MCP_TOOL_NAMES,
  type BrowserMcpApi,
  browserMcpLabelFallback,
  browserMcpLabelKey,
  type BrowserMcpTranslate,
  formatBrowserMcpShortLabel,
  isBrowserMcpApiName,
  parseBrowserMcpApi,
} from './Inspector/browserMcpLabels';
export {
  capitalize,
  formatLinearMcpShortLabel,
  getLinearToolSuffix,
  isLinearMcpApiName,
  LINEAR_MCP_PREFIX,
  LINEAR_MCP_TOOL_NAMES,
  type ParsedTool,
  parseToolName,
  staticLabelFor,
} from './Inspector/linearMcpLabels';
