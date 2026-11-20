import { afterEach, describe, expect, it, vi } from 'vitest';

import { createToolsEngine } from './index';

/**
 * Client-run chats build their connector tool sets from the rows the server
 * listed for the conversation (`connector.listForRun`), each under its own
 * tool prefix: only the server knows a private agent's own topic, and only it
 * holds the owner's personal rows.
 */
let mockConnectors: any[] = [];
let mockRunConnectors: any[] | undefined;
let mockComposioServers: any[] = [];

vi.mock('@/services/runConnectors', () => ({
  getRunConnectors: () => mockRunConnectors,
}));
vi.mock('@/store/tool', () => ({
  getToolStoreState: () => ({
    agentConnectors: {},
    builtinSkills: [],
    builtinTools: [],
    composioServers: mockComposioServers,
    connectors: mockConnectors,
    installedPlugins: [],
    lobehubSkillServers: [],
  }),
}));
vi.mock('@/store/serverConfig', () => ({ getServerConfigStoreState: () => undefined }));
vi.mock('../isCanUseFC', () => ({ isCanUseFC: () => true }));

describe("the conversation's server-listed connector rows", () => {
  const row = (id: string, toolIdentifier: string, toolName: string, extra = {}) => ({
    credentials: null,
    id,
    identifier: 'github',
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://mcp.example/github',
    metadata: null,
    name: 'GitHub',
    sourceType: 'custom',
    status: 'connected',
    toolIdentifier,
    tools: [
      {
        id: `${id}-tool`,
        inputSchema: { properties: {}, type: 'object' },
        permission: 'auto',
        toolName,
        userConnectorId: id,
      },
    ],
    ...extra,
  });
  const toolNames = () =>
    createToolsEngine({ agentId: 'agt-private', topicId: 'tpc-own' })
      .generateToolsDetailed({ model: 'gpt-4', provider: 'openai', toolIds: ['github'] })
      .tools?.map((tool) => tool.function.name)
      .filter((name) => name.startsWith('github'));

  afterEach(() => {
    mockRunConnectors = undefined;
  });

  it("offers a private agent its owner's personal connector, which no workspace list holds", () => {
    // Regression: client-run chats built connector tools from the workspace
    // list alone, so the owner's personal connector — which the server runs
    // in the private agent's own topic — was never offered to the model.
    mockConnectors = [row('c-shared', 'github', 'list_issues')];
    mockRunConnectors = [
      row('c-shared', 'github', 'list_issues'),
      row('c-personal', 'github-cpersona', 'create_issue', { workspaceId: null }),
    ];

    expect(toolNames()).toEqual([
      'github____list_issues____mcp',
      'github-cpersona____create_issue____mcp',
    ]);
  });

  it('offers only what the server listed: a link-shared topic keeps private rows out', () => {
    mockConnectors = [
      row('c-shared', 'github', 'list_issues'),
      row('c-mine', 'github-cmine', 'create_issue', { visibility: 'private' }),
    ];
    mockRunConnectors = [row('c-shared', 'github', 'list_issues')];

    expect(toolNames()).toEqual(['github____list_issues____mcp']);
  });

  it('offers no Composio app whose only connection the conversation may not use', () => {
    // Regression: a shared Composio connection switched to private kept its
    // projection, so a workspace agent's client-run chat offered tools whose
    // every call the server refuses.
    const gmail = {
      id: 'c-gmail',
      identifier: 'gmail',
      metadata: { composio: { connectedAccountId: 'ca-1' } },
      visibility: 'private',
    };
    mockConnectors = [gmail];
    mockComposioServers = [
      { identifier: 'gmail', label: 'Gmail', status: 'active', tools: [{ name: 'GMAIL_SEND' }] },
    ];
    const gmailTools = () =>
      createToolsEngine({ agentId: 'agt', topicId: 'tpc' })
        .generateToolsDetailed({ model: 'gpt-4', provider: 'openai', toolIds: ['gmail'] })
        .tools?.filter((tool) => tool.function.name.startsWith('gmail')).length ?? 0;

    mockRunConnectors = [];
    expect(gmailTools()).toBe(0);
    // The owner's private agent's own conversation lists the connection
    mockRunConnectors = [gmail];
    expect(gmailTools()).toBeGreaterThan(0);
    mockComposioServers = [];
    mockConnectors = [];
  });
});
