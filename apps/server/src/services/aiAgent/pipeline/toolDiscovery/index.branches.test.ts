/**
 * Characterization tests for the branches of `discoverTools` that the
 * existing scenario suites (installed plugins, discoverable connectors, share
 * gate, feature gate, parallel reads) do not reach: the disabled-tools short
 * circuit, client function tools, connector permission patching, the
 * ownership note, turn-scoped builtins, device routing and the fixed-device
 * failure, group-supervisor authorization, and the credential snapshot.
 */
import { LobeAgentManifest } from '@lobechat/builtin-tool-lobe-agent';
import { MessageToolIdentifier } from '@lobechat/builtin-tool-message';
import { RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import { TaskIdentifier } from '@lobechat/builtin-tool-task';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as MechaModule from '@/server/modules/Mecha';
import { createServerAgentToolsEngine } from '@/server/modules/Mecha';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';
import {
  buildConnectorOwnershipPrompt,
  collectBorrowedConnectors,
} from '@/server/utils/connectorAttribution';

import { discoverTools } from '.';

vi.mock('@/business/client/model-bank/loadModels', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/server/services/agentSignal/featureGate', () => ({
  isAgentSignalEnabledForUser: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/database/models/aiModel', () => ({
  AiModelModel: class {
    findByIdAndProvider = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('@/database/models/aiProvider', () => ({
  AiProviderModel: class {
    findById = vi.fn().mockResolvedValue(undefined);
  },
}));
const { chatGroupState } = vi.hoisted(() => ({
  chatGroupState: {
    roster: [] as Array<{ agentId: string; role: string | null; title: string | null }>,
  },
}));
vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: class {
    findById = vi.fn(async () => ({ content: 'group prompt', title: 'Group' }));
    getGroupAgentsWithMeta = vi.fn(async () => chatGroupState.roster);
  },
}));
const { projectState } = vi.hoisted(() => ({
  projectState: {
    coordinatorAgentId: 'coordinator-1' as string | null,
    inboxAgentId: 'lobe-ai',
    knowledgeBaseIds: [] as string[],
  },
}));
vi.mock('@/database/models/project', () => ({
  ProjectModel: class {
    findById = vi.fn(async (id: string) => ({
      coordinatorAgentId: projectState.coordinatorAgentId,
      id,
    }));
    getEnabledKnowledgeBaseIds = vi.fn(async () => projectState.knowledgeBaseIds);
    // A cleared main agent reads back as LobeAI.
    resolveCoordinatorAgents = vi.fn(async (items: Array<{ coordinatorAgentId: string | null }>) =>
      items.map((item) => ({
        ...item,
        coordinatorAgentId: item.coordinatorAgentId ?? projectState.inboxAgentId,
      })),
    );
  },
}));
const { connectorToolState } = vi.hoisted(() => ({
  connectorToolState: { tools: [] as Array<{ permission: string; toolName: string }> },
}));
// Permission patching builds its own model rather than using `deps`.
vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: class {
    queryByConnector = vi.fn(async () => connectorToolState.tools);
  },
}));
vi.mock('@/server/services/connector/refresh', () => ({
  buildLastSyncedAtMap: vi.fn().mockReturnValue(new Map()),
  scheduleStaleConnectorToolsRefresh: vi.fn(),
}));
const { deviceGatewayState } = vi.hoisted(() => ({ deviceGatewayState: { isConfigured: false } }));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    get isConfigured() {
      return deviceGatewayState.isConfigured;
    },
  },
}));
vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({
  getScopedOnlineDevices: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/server/utils/connectorAttribution', () => ({
  buildConnectorOwnershipPrompt: vi.fn().mockReturnValue(''),
  collectBorrowedConnectors: vi.fn().mockReturnValue([]),
  resolveUserDisplayMap: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock('@/server/services/aiAgent/helpers/mediaAvailability', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isMultimodalUnderstandingConfigured: vi.fn(() => true),
}));
vi.mock('@/server/modules/Mecha', async (importOriginal) => {
  const actual = await importOriginal<typeof MechaModule>();
  return {
    ...actual,
    createServerAgentToolsEngine: vi.fn(actual.createServerAgentToolsEngine),
  };
});

const skillManifest = (identifier: string) => ({
  api: [
    {
      description: `${identifier} api`,
      name: 'doThing',
      parameters: { properties: {}, type: 'object' },
    },
  ],
  identifier,
  meta: { title: identifier },
  type: 'builtin',
});

interface RunOptions {
  agentConfig?: Record<string, unknown>;
  appContext?: Record<string, unknown>;
  canUseDevice?: boolean;
  composioManifests?: unknown[];
  connectorResolve?: (ids: string[]) => unknown[];
  connectorTools?: Array<{ permission: string; toolName: string }>;
  credsList?: () => Promise<unknown>;
  input?: Record<string, unknown>;
  installedPlugins?: unknown[];
  lobehubSkillManifests?: unknown[];
  workspaceId?: string;
}

const run = (options: RunOptions = {}) => {
  connectorToolState.tools = options.connectorTools ?? [];
  const messageModel = { update: vi.fn() };
  const credsList = options.credsList ?? vi.fn().mockResolvedValue({ data: [] });
  const promise = discoverTools(
    {
      agentDocumentsService: { hasDocuments: vi.fn().mockResolvedValue(false) },
      composioService: {
        getComposioManifests: vi.fn().mockResolvedValue(options.composioManifests ?? []),
      },
      connectorModel: {
        resolveAll: vi.fn().mockResolvedValue([]),
        resolveByIdentifiers: vi.fn(async (ids: string[]) => options.connectorResolve?.(ids) ?? []),
      },
      connectorToolModel: {
        queryAllByConnectorIds: vi.fn().mockResolvedValue([]),
      },
      db: {} as never,
      getMarketService: vi.fn().mockResolvedValue({
        getLobehubSkillManifests: vi.fn().mockResolvedValue(options.lobehubSkillManifests ?? []),
        market: {
          creds: { list: credsList },
          organizations: { creds: () => ({ list: credsList }) },
        },
      }),
      messageModel,
      pluginModel: { query: vi.fn().mockResolvedValue(options.installedPlugins ?? []) },
      userId: 'user-1',
      workspaceId: options.workspaceId,
    } as never,
    {
      agentConfig: { chatConfig: {}, id: 'agent-1', plugins: [], ...options.agentConfig },
      appContext: options.appContext,
      assistantMessageId: 'assistant-1',
      canUseDevice: options.canUseDevice ?? false,
      model: 'test-model',
      prompt: 'hello',
      provider: 'test-provider',
      resolvedAgentId: 'agent-1',
      runFacts: {
        deviceSystemInfo: vi.fn().mockResolvedValue(undefined),
        userPreference: vi.fn().mockResolvedValue(undefined),
      },
      shareGate: undefined,
      topicId: undefined,
    } as never,
    {
      disabledPluginIds: [],
      globalMemoryEnabled: false,
      hasMentionedAgents: false,
      isFixedDeviceTarget: false,
      loadHistoryMessages: vi.fn().mockResolvedValue([]),
      throwIfExecutionAborted: vi.fn(),
      ...options.input,
    } as never,
  );
  return { messageModel, promise };
};

const lastEngineOptions = () =>
  vi.mocked(createServerAgentToolsEngine).mock.calls.at(-1)?.[1] as Record<string, any>;

beforeEach(() => {
  deviceGatewayState.isConfigured = false;
  chatGroupState.roster = [];
  projectState.coordinatorAgentId = 'coordinator-1';
  projectState.inboxAgentId = 'lobe-ai';
  projectState.knowledgeBaseIds = [];
  vi.mocked(getScopedOnlineDevices).mockReset().mockResolvedValue([]);
  vi.mocked(collectBorrowedConnectors).mockReset().mockReturnValue([]);
  vi.mocked(buildConnectorOwnershipPrompt).mockReset().mockReturnValue('');
  vi.mocked(createServerAgentToolsEngine).mockClear();
});

const functionTools = [
  { description: 'Look up the weather', name: 'getWeather', parameters: { type: 'object' } },
];

describe('discoverTools — disabled tools and client function tools', () => {
  it('skips discovery entirely but still registers client function tools', async () => {
    const result = await run({ input: { disableTools: true, functionTools } }).promise;

    expect(result.toolsEngine).toBeUndefined();
    expect(result.tools).toHaveLength(1);
    expect(result.tools?.[0].function.name).toBe('lobe-client-fn____getWeather');
    expect(createServerAgentToolsEngine).not.toHaveBeenCalled();
    expect(result.toolsResult.enabledToolIds).toEqual(['lobe-client-fn']);
    expect(result.toolSourceMap['lobe-client-fn']).toBe('client');
    expect(result.toolManifestMap['lobe-client-fn']).toEqual({
      api: [
        { description: 'Look up the weather', name: 'getWeather', parameters: { type: 'object' } },
      ],
      identifier: 'lobe-client-fn',
      meta: { title: 'Client Functions' },
      type: 'default',
    });
    expect(result.executionPlan).toBeUndefined();
  });

  it('appends client function tools after the generated tool list', async () => {
    const result = await run({ input: { functionTools } }).promise;

    expect(result.tools?.at(-1)).toEqual({
      function: {
        description: 'Look up the weather',
        name: 'lobe-client-fn____getWeather',
        parameters: { type: 'object' },
      },
      type: 'function',
    });
    expect(result.toolsResult.enabledToolIds.at(-1)).toBe('lobe-client-fn');
  });

  it('keeps an exclusive function-only surface despite media and self-feedback injection', async () => {
    const result = await run({
      agentConfig: { plugins: ['lobe-agent'] },
      input: { exclusivePluginIds: [], externalFileTypes: ['image/png'], functionTools },
    }).promise;

    expect(result.agentPlugins).toEqual([]);
    expect(result.toolsResult.enabledToolIds).toEqual(['lobe-client-fn']);
    expect(Object.keys(result.toolManifestMap)).toEqual(['lobe-client-fn']);
    expect(result.tools?.map((tool) => tool.function.name)).toEqual([
      'lobe-client-fn____getWeather',
    ]);
  });
});

describe('discoverTools — connector permissions and ownership', () => {
  it('patches skill, composio and community-MCP plugin manifests with connector permissions', async () => {
    const plugin = {
      customParams: {},
      identifier: 'community-mcp',
      manifest: skillManifest('community-mcp'),
    };
    const result = await run({
      composioManifests: [skillManifest('composio-gmail')],
      connectorResolve: (ids) =>
        ids.map((identifier, index) => ({ id: `conn-${index}`, identifier })),
      connectorTools: [{ permission: 'needs_approval', toolName: 'doThing' }],
      installedPlugins: [plugin],
      lobehubSkillManifests: [skillManifest('lobehub-notion')],
    }).promise;

    expect(result.lobehubSkillManifests[0].api[0]).toMatchObject({
      humanIntervention: 'required',
    });
    expect(result.composioManifests[0].api[0]).toMatchObject({ humanIntervention: 'required' });
    expect(lastEngineOptions().additionalManifests.map((m: any) => m.identifier)).toEqual([
      'lobehub-notion',
      'composio-gmail',
    ]);
    // The patched plugin is what the engine is built from.
    const engineContext = vi.mocked(createServerAgentToolsEngine).mock.calls.at(-1)?.[0] as any;
    expect(engineContext.installedPlugins[0].manifest.api[0]).toMatchObject({
      humanIntervention: 'required',
    });
  });

  it('returns the borrowed-connector ownership note as run context', async () => {
    vi.mocked(collectBorrowedConnectors).mockReturnValue([{ authorizerId: 'user-2' }] as never);
    vi.mocked(buildConnectorOwnershipPrompt).mockReturnValue('runs on user-2 account');

    const result = await run().promise;

    expect(result.connectorOwnershipNote).toBe('runs on user-2 account');
  });

  it('leaves the ownership note unset when nothing is borrowed', async () => {
    const result = await run().promise;

    expect(result.connectorOwnershipNote).toBeUndefined();
  });
});

describe('discoverTools — turn-scoped builtins', () => {
  it('adds the message tool and a participant group context for bot conversations', async () => {
    const result = await run({
      agentConfig: { title: 'Helper' },
      input: { botContext: { platform: 'discord' } },
    }).promise;

    expect(result.agentPlugins).toContain(MessageToolIdentifier);
    expect(result.operationAgentGroup).toMatchObject({
      currentAgentId: 'agent-1',
      currentAgentName: 'Helper',
      currentAgentRole: 'participant',
    });
    expect(lastEngineOptions().isBotConversation).toBe(true);
    expect(lastEngineOptions().manifestContext.botPlatform.id).toBe('discord');
  });

  it('adds multimodal understanding when the model cannot see an attached image', async () => {
    const result = await run({ input: { externalFileTypes: ['image/png'] } }).promise;

    expect(result.agentPlugins).toContain(LobeAgentManifest.identifier);
  });

  it('gives a project coordinator the task tool and the project knowledge', async () => {
    projectState.coordinatorAgentId = 'agent-1';
    projectState.knowledgeBaseIds = ['kb-project'];

    const result = await run({ appContext: { projectId: 'project-1' } }).promise;

    expect(result.agentPlugins).toContain(TaskIdentifier);
    expect(lastEngineOptions().hasEnabledKnowledgeBases).toBe(true);
  });

  it('gives LobeAI the task tool in a project whose main agent was cleared', async () => {
    // The run agent is LobeAI: a cleared main agent resolves to it.
    projectState.coordinatorAgentId = null;
    projectState.inboxAgentId = 'agent-1';

    const result = await run({ appContext: { projectId: 'project-1' } }).promise;

    expect(result.agentPlugins).toContain(TaskIdentifier);
  });

  it('lets a project member search project knowledge without delegating work', async () => {
    projectState.knowledgeBaseIds = ['kb-project'];

    const result = await run({ appContext: { projectId: 'project-1' } }).promise;

    expect(result.agentPlugins).not.toContain(TaskIdentifier);
    expect(lastEngineOptions().hasEnabledKnowledgeBases).toBe(true);
  });

  it('adds nothing turn-scoped for a plain text turn', async () => {
    const result = await run().promise;

    expect(result.agentPlugins).not.toContain(MessageToolIdentifier);
    expect(result.agentPlugins).not.toContain(LobeAgentManifest.identifier);
    expect(result.agentPlugins).not.toContain(TaskIdentifier);
    expect(lastEngineOptions().hasEnabledKnowledgeBases).toBe(false);
    expect(result.operationAgentGroup).toBeUndefined();
  });
});

describe('discoverTools — device routing', () => {
  it('routes to the single online device and strips the device picker', async () => {
    deviceGatewayState.isConfigured = true;
    vi.mocked(getScopedOnlineDevices).mockResolvedValue([
      { deviceId: 'dev-1', online: true, scope: 'personal' },
    ] as never);

    const result = await run({
      agentConfig: { agencyConfig: { executionTarget: 'auto' } },
      canUseDevice: true,
    }).promise;

    expect(result.executionPlan).toMatchObject({ deviceId: 'dev-1', kind: 'device' });
    expect(result.activeDeviceId).toBe('dev-1');
    expect(result.activeDeviceScope).toBe('personal');
    expect(result.onlineDevices.map((d) => d.deviceId)).toEqual(['dev-1']);
    // A routed run is device-locked: the picker never reaches the model.
    expect(result.toolManifestMap[RemoteDeviceManifest.identifier]).toBeUndefined();
  });

  it('lists every online device in the RemoteDevice systemRole when none is routed', async () => {
    deviceGatewayState.isConfigured = true;
    vi.mocked(getScopedOnlineDevices).mockResolvedValue([
      { deviceId: 'dev-1', online: true, scope: 'personal' },
      { deviceId: 'dev-2', online: true, scope: 'personal' },
    ] as never);

    const result = await run({
      agentConfig: { agencyConfig: { executionTarget: 'auto' } },
      canUseDevice: true,
    }).promise;

    expect(result.activeDeviceId).toBeUndefined();
    const systemRole = result.toolManifestMap[RemoteDeviceManifest.identifier]?.systemRole;
    expect(systemRole).toContain('dev-1');
    expect(systemRole).toContain('dev-2');
  });

  it('adds the caller personal device to a workspace pool when the agent binds it', async () => {
    deviceGatewayState.isConfigured = true;
    vi.mocked(getScopedOnlineDevices).mockImplementation(async (_db, _userId, workspaceId) =>
      workspaceId ? [] : ([{ deviceId: 'dev-p', online: true, scope: 'personal' }] as never),
    );

    const result = await run({
      agentConfig: { agencyConfig: { boundDeviceId: 'dev-p', executionTarget: 'local' } },
      canUseDevice: true,
      workspaceId: 'ws-1',
    }).promise;

    expect(getScopedOnlineDevices).toHaveBeenCalledTimes(2);
    expect(result.activeDeviceId).toBe('dev-p');
    expect(result.activeDeviceScope).toBe('personal');
  });

  it('does not route a device when device access is denied', async () => {
    deviceGatewayState.isConfigured = true;
    vi.mocked(getScopedOnlineDevices).mockResolvedValue([
      { deviceId: 'dev-1', online: true, scope: 'personal' },
    ] as never);

    const result = await run({ canUseDevice: false }).promise;

    expect(result.activeDeviceId).toBeUndefined();
    expect(result.executionPlan?.kind).not.toBe('device');
  });

  it('fails the run with a persisted error when a fixed device is offline', async () => {
    deviceGatewayState.isConfigured = true;
    const { messageModel, promise } = run({
      agentConfig: {
        agencyConfig: {
          boundDeviceId: 'dev-fixed',
          executionTarget: 'device',
          executionTargetSelectionPolicy: 'fixed',
        },
      },
      canUseDevice: true,
      input: { isFixedDeviceTarget: true },
    });

    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(TRPCError);
    expect(error.code).toBe('PRECONDITION_FAILED');
    expect(error.message).toBe(
      'The device fixed by this agent is offline. Ask an editor to bring it online or change the agent device policy.',
    );
    expect(messageModel.update).toHaveBeenCalledWith('assistant-1', {
      content: '',
      error: {
        body: {
          code: 'DEVICE_NOT_FOUND',
          detail: error.message,
          deviceId: 'dev-fixed',
          retryable: true,
          scope: 'personal',
        },
        message: 'Fixed agent device unavailable',
        type: 'ServerAgentRuntimeError',
      },
    });
  });
});

describe('discoverTools — group orchestration', () => {
  it.each([
    { expected: true, name: 'a persisted supervisor', role: 'supervisor' },
    { expected: false, name: 'a participant claiming supervisor', role: 'participant' },
  ])('authorizes group tools only for $name', async ({ expected, role }) => {
    chatGroupState.roster = [{ agentId: 'agent-1', role, title: 'Me' }];

    const result = await run({
      appContext: { groupId: 'group-1', orchestrationRole: 'supervisor' },
    }).promise;

    expect(lastEngineOptions().isGroupSupervisor).toBe(expected);
    expect(result.operationAgentGroup?.currentAgentId).toBe('agent-1');
  });
});

describe('discoverTools — credential snapshot', () => {
  it('freezes the credential list when the creds tool is enabled', async () => {
    const credsList = vi.fn().mockResolvedValue({
      data: [
        {
          description: 'd',
          extra: 'dropped',
          key: 'github',
          name: 'GitHub',
          ownerDisplayName: 'Me',
          ownerType: 'user',
          type: 'oauth',
        },
      ],
    });
    const result = await run({
      agentConfig: { plugins: ['lobe-creds'] },
      credsList,
      workspaceId: 'ws-1',
    }).promise;

    expect(result.toolsResult.enabledToolIds).toContain('lobe-creds');
    await expect(result.credentialFactsPromise).resolves.toEqual({
      credentials: [
        {
          description: 'd',
          key: 'github',
          name: 'GitHub',
          ownerDisplayName: 'Me',
          ownerType: 'user',
          type: 'oauth',
        },
      ],
      workspaceId: 'ws-1',
    });
  });

  it('resolves to undefined when the credential read fails', async () => {
    const result = await run({
      agentConfig: { plugins: ['lobe-creds'] },
      credsList: vi.fn().mockRejectedValue(new Error('market down')),
    }).promise;

    await expect(result.credentialFactsPromise).resolves.toBeUndefined();
  });

  it('does not read credentials when the creds tool is not enabled', async () => {
    const credsList = vi.fn();
    const result = await run({ credsList }).promise;

    expect(result.credentialFactsPromise).toBeUndefined();
    expect(credsList).not.toHaveBeenCalled();
  });
});

it.each(['http', 'stdio'] as const)(
  'keeps server-owned installed-plugin %s configuration through discovery and executor selection',
  async (type) => {
    const connection =
      type === 'http'
        ? { type, url: 'https://example.test/mcp', headers: { tenant: 'one' } }
        : { type, command: 'fixture', args: ['--stdio'] };
    const result = await run({
      agentConfig: { plugins: ['installed-mcp'] },
      installedPlugins: [
        {
          identifier: 'installed-mcp',
          customParams: { mcp: connection },
          manifest: { ...skillManifest('installed-mcp'), type: 'mcp' },
        },
      ],
    }).promise;
    expect(result.toolManifestMap['installed-mcp']).toMatchObject({
      mcpParams: { ...connection, name: 'installed-mcp' },
    });
    if (type === 'stdio') expect(result.toolExecutorMap['installed-mcp']).toBe('client');
  },
);
