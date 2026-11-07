import { type ResolvedToolSet, ToolNameResolver } from '@lobechat/context-engine';
import { type MessageToolCall } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ChatStore } from '@/store/chat/store';

import { PluginInternalsActionImpl } from './internals';

const gate = vi.hoisted(() => ({ enabled: true }));
vi.mock('@lobechat/builtin-tools', () => ({ builtinTools: [] }));
vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => ({}),
  serverConfigSelectors: { enableMcpApps: () => gate.enabled },
}));
vi.mock('@/store/tool', () => ({ useToolStore: { getState: () => ({}) } }));
vi.mock('@/store/tool/selectors', () => ({
  composioStoreSelectors: { composioAsLobeTools: () => [] },
  lobehubSkillStoreSelectors: { lobehubSkillAsLobeTools: () => [] },
  pluginSelectors: { confirmedInstalledPlugins: () => [] },
}));

const identifier = 'MCPAppsAcceptanceFixture';
const apiName = 'fixture_fullscreen_preference';
const toolName = new ToolNameResolver().generate(identifier, apiName, 'mcp');
const calls: MessageToolCall[] = [
  { function: { arguments: '{}', name: toolName }, id: 'call-1', type: 'function' },
];
const snapshot: Pick<ResolvedToolSet, 'manifestMap' | 'sourceMap'> = {
  manifestMap: {
    [identifier]: {
      api: [
        {
          description: 'Show an App',
          name: apiName,
          parameters: { type: 'object', properties: {} },
        },
      ],
      identifier,
      meta: { title: 'MCP Apps Acceptance Fixture' },
      type: 'mcp',
    },
  },
  sourceMap: { [identifier]: 'mcp' },
};
const actions = new PluginInternalsActionImpl(vi.fn(), () => ({}) as ChatStore);

beforeEach(() => {
  gate.enabled = true;
});

describe('MCP App connector tool names', () => {
  it.each([snapshot.sourceMap, {}])(
    'restores the advertised hashed connector API with source map %j',
    (sourceMap) => {
      expect(toolName).toContain('MD5HASH_');
      expect(
        actions.internal_transformToolCalls(calls, [toolName], { ...snapshot, sourceMap }),
      ).toEqual([
        { apiName, arguments: '{}', id: 'call-1', identifier, source: 'mcp', type: 'mcp' },
      ]);
    },
  );

  it('does not recover a bare tool name that was not offered to the model', () => {
    const bareCalls = [{ ...calls[0], function: { arguments: '{}', name: apiName } }];
    expect(actions.internal_transformToolCalls(bareCalls, [], snapshot)).toEqual([]);
  });

  it('does not change non-MCP resolution from the operation snapshot', () => {
    const result = actions.internal_transformToolCalls(calls, [toolName], {
      ...snapshot,
      sourceMap: { [identifier]: 'builtin' },
    });
    expect(result[0].apiName).toBe(toolName.split('____')[1]);
    expect(result[0].source).toBeUndefined();
  });

  it('does not read the new snapshot when MCP Apps is disabled', () => {
    gate.enabled = false;
    const readManifest = vi.fn(() => snapshot.manifestMap);
    const result = actions.internal_transformToolCalls(calls, [toolName], {
      get manifestMap() {
        return readManifest();
      },
      sourceMap: snapshot.sourceMap,
    });
    expect(readManifest).not.toHaveBeenCalled();
    expect(result[0].apiName).toBe(toolName.split('____')[1]);
    expect(result[0].source).toBeUndefined();
  });
});
