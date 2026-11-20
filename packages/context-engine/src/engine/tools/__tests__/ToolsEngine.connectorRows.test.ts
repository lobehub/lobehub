import { describe, expect, it } from 'vitest';

import { ToolsEngine } from '../ToolsEngine';
import type { LobeToolManifest } from '../types';

const row = (identifier: string, id: string, toolName: string): LobeToolManifest => ({
  api: [{ description: toolName, name: toolName, parameters: {} }],
  connector: { id, identifier: 'github' },
  identifier,
  meta: { title: identifier },
  type: 'mcp',
});

const shared = row('github', 'c-shared', 'create_issue');
const mine = row('github-3f9a1c2e', 'c-private', 'create_issue');
const input = (toolIds: string[]) => ({
  model: 'gpt-4',
  provider: 'openai',
  skipDefaultTools: true,
  toolIds,
});

/**
 * Same-identifier connector rows (the workspace's shared one, the caller's
 * private or personal one) are each their own tool set. Agent configuration
 * names the connector by its base identifier, which enables every row.
 */
describe('ToolsEngine connector rows', () => {
  it('enables every row of a connector named by its base identifier', () => {
    const engine = new ToolsEngine({ manifestSchemas: [shared, mine] });

    const result = engine.generateToolsDetailed(input(['github']));

    expect(result.enabledToolIds).toEqual(['github', 'github-3f9a1c2e']);
    expect(result.tools?.map((tool) => tool.function.name)).toEqual([
      'github____create_issue____mcp',
      'github-3f9a1c2e____create_issue____mcp',
    ]);
    expect([...engine.getEnabledPluginManifests(['github']).keys()]).toEqual([
      'github',
      'github-3f9a1c2e',
    ]);
  });

  it('enables a private-only connector without reporting its base id missing', () => {
    const engine = new ToolsEngine({ manifestSchemas: [mine] });

    const result = engine.generateToolsDetailed(input(['github']));

    expect(result.enabledToolIds).toEqual(['github-3f9a1c2e']);
    expect(result.filteredTools).toEqual([]);
  });

  it('asks the enable checker about the connector, not the row', () => {
    const asked: string[] = [];
    const engine = new ToolsEngine({
      enableChecker: ({ pluginId }) => {
        asked.push(pluginId);
        return pluginId !== 'github';
      },
      manifestSchemas: [shared, mine],
    });

    const result = engine.generateToolsDetailed(input(['github']));

    expect(asked).toEqual(['github', 'github']);
    expect(result.enabledToolIds).toEqual([]);
  });
});
