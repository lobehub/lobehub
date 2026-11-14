import { type AgentState, GeneralChatAgent } from '@lobechat/agent-runtime';
import { withMandatoryApprovalMark } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import type { DecryptedConnector } from '@/database/models/connector';
import type { ConnectorCredentials, UserConnectorToolItem } from '@/database/schemas';

import { buildConnectorManifests } from './buildConnectorManifests';

const httpConnector = (
  credentials: ConnectorCredentials | null,
  metadata?: Record<string, unknown>,
): DecryptedConnector =>
  ({
    credentials,
    id: 'c1',
    identifier: 'my-conn',
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://mcp.example.com',
    mcpStdioConfig: null,
    metadata: metadata ?? null,
    name: 'My Connector',
    oidcConfig: null,
  }) as any;

const tool = (): UserConnectorToolItem =>
  ({
    crudType: 'read',
    id: 't1',
    inputSchema: { properties: {}, type: 'object' },
    permission: 'auto',
    toolName: 'doThing',
    userConnectorId: 'c1',
  }) as any;

const mcpParamsOf = (connector: DecryptedConnector) => {
  const [manifest] = buildConnectorManifests([connector], [tool()]);
  // mcpParams is a runtime-only field not in the public ToolManifest type.
  return (manifest as any).mcpParams as { auth?: unknown; headers?: Record<string, string> };
};

describe('buildConnectorManifests mcpParams headers', () => {
  it('merges metadata.customHeaders alongside bearer auth', () => {
    const params = mcpParamsOf(
      httpConnector({ token: 'tok', type: 'bearer' }, { customHeaders: { 'X-Tenant': 't1' } }),
    );

    expect(params.auth).toEqual({ token: 'tok', type: 'bearer' });
    expect(params.headers).toEqual({ 'X-Tenant': 't1' });
  });

  it('applies metadata.customHeaders with no auth credential', () => {
    const params = mcpParamsOf(httpConnector(null, { customHeaders: { 'X-Api-Key': 'abc' } }));

    expect(params.auth).toBeUndefined();
    expect(params.headers).toEqual({ 'X-Api-Key': 'abc' });
  });

  it('lets metadata.customHeaders override legacy header-credential keys', () => {
    const params = mcpParamsOf(
      httpConnector(
        { headers: { Authorization: 'Token old' }, type: 'header' },
        { customHeaders: { Authorization: 'Token new' } },
      ),
    );

    expect(params.headers).toEqual({ Authorization: 'Token new' });
  });

  it('leaves headers undefined when there are none (unchanged behavior)', () => {
    const params = mcpParamsOf(httpConnector({ token: 'tok', type: 'bearer' }));

    expect(params.auth).toEqual({ token: 'tok', type: 'bearer' });
    expect(params.headers).toBeUndefined();
  });
});

describe('buildConnectorManifests cloud connectors', () => {
  it('routes a cloud connector to the cloud executor by identifier', () => {
    const connector = {
      ...httpConnector(null, { cloudEndPoint: 'https://cloud.example', customHeaders: { A: '1' } }),
      mcpConnectionType: 'cloud',
      mcpServerUrl: null,
    } as DecryptedConnector;

    expect(mcpParamsOf(connector)).toEqual({
      headers: { A: '1' },
      name: 'my-conn',
      type: 'cloud',
      url: 'https://cloud.example',
    });
  });
});

describe('buildConnectorManifests approval', () => {
  const cloudConnector = {
    ...httpConnector(null, { cloudEndPoint: 'https://cloud.example' }),
    mcpConnectionType: 'cloud',
    mcpServerUrl: null,
  } as DecryptedConnector;

  /** A tool as `syncToolsFromClientById` stores it from the market's manifest. */
  const syncedTool = (toolName: string, humanIntervention: unknown, permission: string) =>
    ({
      ...tool(),
      metadata: withMandatoryApprovalMark(null, humanIntervention),
      permission,
      toolName,
    }) as UserConnectorToolItem;

  /** What the runtime's approval gate does with one call under `approvalMode`. */
  const gate = async (manifests: ReturnType<typeof buildConnectorManifests>, apiName: string) => {
    const toolCalling = {
      apiName,
      arguments: '{}',
      id: `call-${apiName}`,
      identifier: 'my-conn',
      type: 'mcp',
    } as const;
    const now = new Date().toISOString();
    const state = {
      cost: { calculatedAt: now, currency: 'USD', total: 0 },
      createdAt: now,
      lastModified: now,
      messages: [],
      operationId: 'op',
      status: 'running',
      stepCount: 0,
      toolManifestMap: Object.fromEntries(manifests.map((m) => [m.identifier, m])),
      usage: {},
      userInterventionConfig: { allowList: [], approvalMode: 'auto-run' },
    } as unknown as AgentState;
    const agent = new GeneralChatAgent({
      agentConfig: { maxSteps: 10 },
      modelRuntimeConfig: { model: 'm', provider: 'p' },
      operationId: 'op',
    });
    const [instruction] = await agent.runner(
      {
        payload: { hasToolsCalling: true, parentMessageId: 'msg', toolsCalling: [toolCalling] },
        phase: 'llm_result',
        session: { messageCount: 0, sessionId: 'op', status: 'running', stepCount: 0 },
      } as any,
      state,
    );
    return (instruction as { type: string }).type;
  };

  // Auto-run skips `required`; a market `always` must still stop the call
  it('keeps a cloud tool the market marks always behind approval in auto-run', async () => {
    const manifests = buildConnectorManifests(
      [cloudConnector],
      [
        syncedTool('delete_repo', 'always', 'needs_approval'),
        syncedTool('purge', [{ match: { force: true }, policy: 'always' }], 'auto'),
        syncedTool('send_mail', 'required', 'needs_approval'),
      ],
    );

    expect(manifests[0].api.map((a) => [a.name, a.humanIntervention])).toEqual([
      ['delete_repo', 'always'],
      ['purge', 'always'],
      ['send_mail', 'required'],
    ]);
    expect(await gate(manifests, 'delete_repo')).toBe('request_human_approve');
    expect(await gate(manifests, 'purge')).toBe('request_human_approve');
    expect(await gate(manifests, 'send_mail')).toBe('call_tool');
  });
});
