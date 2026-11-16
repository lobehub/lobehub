import { McpEventsIdentifier } from '@lobechat/builtin-tool-mcp-events';
import {
  AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS,
  builtinTools,
  runtimeManagedToolIds,
} from '@lobechat/builtin-tools';
import { describe, expect, it } from 'vitest';

import { resolveToolRules } from './resolveToolRules';
import type { ToolRuleRequest } from './types';

const request = (extra: Partial<ToolRuleRequest> = {}): ToolRuleRequest => ({
  agent: { chatConfig: {}, plugins: [] },
  executionTarget: 'sandbox',
  localExecutionReady: false,
  model: { canUseFC: true },
  ...extra,
});

describe('MCP Events tool visibility', () => {
  it('only injects the tool when the server confirms an event connector', () => {
    const absent = resolveToolRules(request());
    expect(absent.rules[McpEventsIdentifier]).toBe(false);
    expect(absent.defaultToolIds).not.toContain(McpEventsIdentifier);
    expect(absent.excludedIdentifiers.has(McpEventsIdentifier)).toBe(true);

    const available = resolveToolRules(request({ hasEventConnector: true }));
    expect(available.rules[McpEventsIdentifier]).toBe(true);
    expect(available.defaultToolIds).toContain(McpEventsIdentifier);
    expect(available.excludedIdentifiers.has(McpEventsIdentifier)).toBe(false);
  });

  it('does not let pinning or explicit activation bypass the capability/feature gate', () => {
    for (const toolMode of ['custom', 'agent'] as const) {
      const gated = resolveToolRules(
        request({ agent: { chatConfig: { toolMode }, plugins: [McpEventsIdentifier] } }),
      );
      expect(gated.excludedIdentifiers.has(McpEventsIdentifier)).toBe(true);
    }
    const chat = resolveToolRules(
      request({ agent: { chatConfig: { toolMode: 'chat' } }, hasEventConnector: true }),
    );
    expect(chat.rules[McpEventsIdentifier]).toBeUndefined();
    expect(chat.defaultToolIds).not.toContain(McpEventsIdentifier);
  });

  it('is hidden and runtime managed, with no share-visitor grant', () => {
    expect(builtinTools.find((tool) => tool.identifier === McpEventsIdentifier)?.hidden).toBe(true);
    expect(runtimeManagedToolIds).toContain(McpEventsIdentifier);
    expect(AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS).not.toContain(McpEventsIdentifier);
  });
});
