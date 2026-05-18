'use client';

import { LinearInspector } from '@lobechat/shared-tool-ui/inspectors';
import type { BuiltinInspector } from '@lobechat/types';

import { LINEAR_MCP_PREFIX, LINEAR_MCP_TOOL_NAMES } from './linearMcpLabels';

// The shared `LinearInspector` already strips `LINEAR_MCP_PREFIX` when
// parsing, so we just register it under every MCP-prefixed wire name CC
// emits for the claude.ai Linear server.
export const LinearMcpInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  LINEAR_MCP_TOOL_NAMES.map((tool) => [`${LINEAR_MCP_PREFIX}${tool}`, LinearInspector]),
);
