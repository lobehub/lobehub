'use client';

import { LinearInspector } from '@lobechat/shared-tool-ui/inspectors';
import type { BuiltinInspector } from '@lobechat/types';

import { isLinearMcpApiName, LINEAR_MCP_PREFIX, LINEAR_MCP_TOOL_NAMES } from './linearMcpLabels';

// The shared `LinearInspector` already strips `LINEAR_MCP_PREFIX` when
// parsing, so we just register it under every MCP-prefixed wire name CC
// emits for the claude.ai Linear server.
const FixedLinearMcpInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  LINEAR_MCP_TOOL_NAMES.map((tool) => [`${LINEAR_MCP_PREFIX}${tool}`, LinearInspector]),
);

export const LinearMcpInspectors: Record<string, BuiltinInspector> = new Proxy(
  FixedLinearMcpInspectors,
  {
    get: (target, prop) => {
      if (typeof prop !== 'string') return undefined;
      return target[prop] || (isLinearMcpApiName(prop) ? LinearInspector : undefined);
    },
  },
);
