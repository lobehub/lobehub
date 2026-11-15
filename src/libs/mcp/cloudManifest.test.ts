import { describe, expect, it } from 'vitest';

import { buildCloudMcpManifest, cloudManifestTools } from './cloudManifest';

describe('buildCloudMcpManifest', () => {
  it('keeps the approval an MCP tools-format manifest asks for', () => {
    const manifest = buildCloudMcpManifest({
      data: {
        tools: [
          { description: 'Search', inputSchema: { type: 'object' }, name: 'search' },
          { humanIntervention: 'required', name: 'send' },
          { humanIntervention: 'always', name: 'delete' },
        ],
      },
      plugin: { identifier: 'remote-mcp' },
    });

    expect(
      cloudManifestTools(manifest).map(({ humanIntervention, toolName }) => ({
        humanIntervention,
        toolName,
      })),
    ).toEqual([
      { humanIntervention: undefined, toolName: 'search' },
      { humanIntervention: 'required', toolName: 'send' },
      { humanIntervention: 'always', toolName: 'delete' },
    ]);
    expect(manifest.api[0]).toEqual({
      description: 'Search',
      name: 'search',
      parameters: { type: 'object' },
    });
  });

  it('takes the tools list when the api list beside it is empty', () => {
    const manifest = buildCloudMcpManifest({
      data: { api: [], tools: [{ humanIntervention: 'always', name: 'delete' }] },
      plugin: { identifier: 'remote-mcp' },
    });

    expect(manifest.api).toEqual([
      { description: '', humanIntervention: 'always', name: 'delete', parameters: {} },
    ]);
  });
});
