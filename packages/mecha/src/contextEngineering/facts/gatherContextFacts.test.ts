import { getConnectorCatalog } from '@lobechat/const';
import { describe, expect, it, vi } from 'vitest';

import { gatherContextFacts } from './gatherContextFacts';
import { listOfficialTools } from './officialTools';
import type { ContextFactProviders, ContextFactRequest } from './types';

const request = (overrides: Partial<ContextFactRequest> = {}): ContextFactRequest => ({
  agent: { chatConfig: {} as never, description: 'helps', slug: null, title: 'Helper' },
  agentId: 'agt_1',
  enabledToolIds: [],
  features: { composio: true, lobehubSkill: true },
  messages: [],
  topicId: 'tpc_1',
  ...overrides,
});

const message = (content: string) =>
  ({ content, createdAt: 0, id: 'm', role: 'user', updatedAt: 0 }) as never;

describe('gatherContextFacts', () => {
  it('yields no facts and never throws when the host provides nothing', async () => {
    const facts = await gatherContextFacts(request(), {});

    expect(facts.agentDocuments).toBeUndefined();
    expect(Object.values(facts.step).every((v) => v === undefined)).toBe(true);
    expect(facts.variables).toMatchObject({
      CREDS_LIST: '',
      agent_id: 'agt_1',
      agent_title: 'Helper',
      creds_sandbox_reachable: 'true',
      sandbox_enabled: 'false',
      topic_id: 'tpc_1',
    });
  });

  it('treats a failing provider as a missing fact', async () => {
    const facts = await gatherContextFacts(request(), {
      findTopic: async () => {
        throw new Error('db down');
      },
      getUserInfo: async () => ({ language: 'zh-CN', username: 'arvin' }),
    });

    expect(facts.variables.topic_title).toBe('');
    expect(facts.variables.username).toBe('arvin');
  });

  describe('plan / todo', () => {
    const providers: ContextFactProviders = {
      getPlanDocument: async () => ({
        content: 'ctx',
        createdAt: '2026-01-01T00:00:00.000Z',
        description: 'desc',
        id: 'plan_1',
        metadata: { todos: { items: [{ status: 'todo', text: 'from doc' }] } },
        title: 'Ship it',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }),
    };

    it('injects the plan block from the document and its todos when history has none', async () => {
      const facts = await gatherContextFacts(
        request({ enabledToolIds: ['lobe-agent'] }),
        providers,
      );

      expect(facts.step.planTodo?.plan).toMatchObject({ goal: 'Ship it', description: 'desc' });
      expect(facts.step.planTodo?.todos?.items.map((t) => t.text)).toEqual(['from doc']);
    });

    it('keeps the plan block but takes todos from history when history has them', async () => {
      const facts = await gatherContextFacts(
        request({
          enabledToolIds: ['lobe-agent'],
          messages: [
            {
              content: 'done',
              createdAt: 0,
              id: 't',
              pluginState: { todos: { items: [{ status: 'todo', text: 'from history' }] } },
              role: 'tool',
              updatedAt: 0,
            } as never,
          ],
        }),
        providers,
      );

      expect(facts.step.planTodo?.plan?.goal).toBe('Ship it');
      expect(facts.step.planTodo?.todos?.items.map((t) => t.text)).toEqual(['from history']);
    });

    it('does not read the plan document without lobe-agent', async () => {
      const getPlanDocument = vi.fn(providers.getPlanDocument);
      const facts = await gatherContextFacts(request(), { getPlanDocument });

      expect(getPlanDocument).not.toHaveBeenCalled();
      expect(facts.step.planTodo).toBeUndefined();
    });
  });

  describe('credentials and Composio', () => {
    it('lists credentials for the run scope only when the creds tool is enabled', async () => {
      const listCredentials = vi.fn(async () => [
        { key: 'k', name: 'GitHub', type: 'kv-env' as const },
      ]);

      const off = await gatherContextFacts(request(), { listCredentials });
      expect(listCredentials).not.toHaveBeenCalled();
      expect(off.variables.CREDS_LIST).toBe('');

      const on = await gatherContextFacts(
        request({ enabledToolIds: ['lobe-creds'], workspaceId: 'ws_1' }),
        { listCredentials },
      );
      expect(listCredentials).toHaveBeenCalledWith({ workspaceId: 'ws_1' });
      expect(on.variables.CREDS_LIST).toContain('GitHub');
    });

    it('drops disabled Composio services from both lists and needs the creds tool', async () => {
      const listConnectedConnectorIds = vi.fn(async () => ['gmail', 'slack']);

      const off = await gatherContextFacts(request(), { listConnectedConnectorIds });
      expect(listConnectedConnectorIds).not.toHaveBeenCalled();
      expect(off.variables.COMPOSIO_SERVICES_LIST).toBe('');

      const on = await gatherContextFacts(
        request({ disabledPluginIds: ['slack'], enabledToolIds: ['lobe-creds'] }),
        { listConnectedConnectorIds },
      );
      const list = on.variables.COMPOSIO_SERVICES_LIST as string;
      expect(list).toContain('gmail');
      expect(list).not.toContain('slack');
    });
  });

  describe('share visitor gates', () => {
    const visitor = { agentId: 'agt_1', visitorUserId: 'visitor_1' };

    it('hides documents, onboarding and workspace context from a visitor', async () => {
      const facts = await gatherContextFacts(
        request({
          agent: { slug: 'web-onboarding' },
          enabledToolIds: ['lobe-web-onboarding'],
          shareVisitor: visitor,
          workspaceId: 'ws_1',
        }),
        {
          getOnboardingContext: async () => ({ phaseGuidance: 'go' }) as never,
          getWorkspaceContext: async () => ({ appUrl: 'https://x', slug: 'team' }),
          listAgentDocuments: async () => [{ id: 'd1' }] as never,
        },
      );

      expect(facts.agentDocuments).toBeUndefined();
      expect(facts.step.onboardingContext).toBeUndefined();
      expect(facts.step.workspaceContext).toBeUndefined();
    });

    it('only resolves topic references the visitor started with the shared agent', async () => {
      const findTopic = async (topicId: string) =>
        topicId === 'mine'
          ? { agentId: 'agt_1', historySummary: 'my summary', id: 'mine', senderId: 'visitor_1' }
          : {
              agentId: 'agt_1',
              historySummary: 'creator secret',
              id: 'theirs',
              senderId: 'creator',
            };

      const facts = await gatherContextFacts(
        request({
          messages: [
            message(
              '<refer_topic id="mine">a</refer_topic> <refer_topic id="theirs">b</refer_topic>',
            ),
          ],
          shareVisitor: visitor,
        }),
        { findTopic },
      );

      const summaries = facts.step.topicReferences?.map((r) => r.summary) ?? [];
      expect(summaries).toContain('my summary');
      expect(summaries).not.toContain('creator secret');
    });

    it('never enumerates the owner’s agents, providers or plugins for a visitor', async () => {
      const listRecentAgents = vi.fn(async () => [{ id: 'agt_2', title: 'Owner private' }]);
      const listEnabledProviders = vi.fn(async () => [{ id: 'openai', models: [], name: 'x' }]);
      const listCustomPlugins = vi.fn(async () => []);

      const facts = await gatherContextFacts(
        request({
          // Auto skill mode and even a leaked tool id must not open the door.
          enabledToolIds: ['lobe-agent-management'],
          mentionedAgents: [{ id: 'agt_3', title: 'Mentioned' }] as never,
          shareVisitor: visitor,
        }),
        { listCustomPlugins, listEnabledProviders, listRecentAgents },
      );

      expect(listRecentAgents).not.toHaveBeenCalled();
      expect(listEnabledProviders).not.toHaveBeenCalled();
      expect(listCustomPlugins).not.toHaveBeenCalled();
      expect(facts.step.agentManagementContext).toEqual({
        mentionedAgents: [{ id: 'agt_3', title: 'Mentioned' }],
      });
    });

    it('reads user info for the visitor, not the owner', async () => {
      const getUserInfo = vi.fn(async () => ({ language: 'ja-JP', username: 'v' }));
      await gatherContextFacts(request({ shareVisitor: visitor }), { getUserInfo });
      expect(getUserInfo).toHaveBeenCalledWith('visitor_1');

      await gatherContextFacts(request(), { getUserInfo });
      expect(getUserInfo).toHaveBeenLastCalledWith(undefined);
    });
  });

  it('skips topic references and onboarding already present in the messages', async () => {
    const findTopic = vi.fn();
    const getOnboardingContext = vi.fn();
    await gatherContextFacts(
      request({
        enabledToolIds: ['lobe-web-onboarding'],
        messages: [
          message(
            '<topic_reference_context>…</topic_reference_context> <onboarding_context>…</onboarding_context>',
          ),
        ],
      }),
      { findTopic, getOnboardingContext },
    );
    // The current topic is still looked up for its title; no referenced topic is.
    expect(findTopic.mock.calls.map(([id]) => id)).toEqual(['tpc_1']);
    expect(getOnboardingContext).not.toHaveBeenCalled();
  });

  it('reads the documents of the agent being edited while the builder is active', async () => {
    const listAgentDocuments = vi.fn(async (id: string) => [{ id: `doc-of-${id}` }] as never);

    const plain = await gatherContextFacts(request({ editingAgentId: 'agt_edit' }), {
      listAgentDocuments,
    });
    expect(plain.agentDocuments).toEqual([{ id: 'doc-of-agt_1' }]);

    const building = await gatherContextFacts(
      request({ editingAgentId: 'agt_edit', enabledToolIds: ['lobe-agent-builder'] }),
      { listAgentDocuments },
    );
    expect(building.agentDocuments).toEqual([{ id: 'doc-of-agt_edit' }]);
  });

  describe('agent management', () => {
    const recent = Array.from({ length: 12 }, (_, i) => ({ id: `agt_${i}`, title: `A${i}` }));

    it('lists available agents in auto skill mode without the tool, excluding itself', async () => {
      const facts = await gatherContextFacts(request(), { listRecentAgents: async () => recent });

      const ctx = facts.step.agentManagementContext!;
      expect(ctx.availableAgents?.map((a) => a.id)).not.toContain('agt_1');
      expect(ctx.availableAgents).toHaveLength(10);
      expect(ctx.availableAgentsHasMore).toBe(true);
      expect(ctx.currentAgent).toEqual({ id: 'agt_1', title: 'Helper' });
      expect(ctx.availablePlugins).toBeUndefined();
    });

    it('adds providers and the plugin catalog only when the tool is enabled', async () => {
      const facts = await gatherContextFacts(
        request({
          agent: { chatConfig: { skillActivateMode: 'manual' } as never },
          enabledToolIds: ['lobe-agent-management'],
        }),
        {
          listCustomPlugins: async () => [{ identifier: 'my-mcp', name: 'Mine', type: 'custom' }],
          listEnabledProviders: async () => [{ id: 'openai', models: [], name: 'OpenAI' }],
          listRecentAgents: async () => recent,
        },
      );

      const ctx = facts.step.agentManagementContext!;
      expect(ctx.availableProviders).toEqual([{ id: 'openai', models: [], name: 'OpenAI' }]);
      const types = new Set(ctx.availablePlugins?.map((p) => p.type));
      expect(types).toEqual(new Set(['builtin', 'composio', 'lobehub-skill', 'custom']));
      expect(ctx.availablePlugins?.map((p) => p.identifier)).not.toContain('lobe-agent-builder');
    });

    it('carries mentioned agents even without the tool or auto mode', async () => {
      const facts = await gatherContextFacts(
        request({
          agent: { chatConfig: { skillActivateMode: 'manual' } as never },
          mentionedAgents: [{ id: 'agt_9', title: 'Nine' }] as never,
        }),
        {},
      );
      expect(facts.step.agentManagementContext).toEqual({
        mentionedAgents: [{ id: 'agt_9', title: 'Nine' }],
      });
    });
  });

  it('lists LobeHub skill connectors in the official tool catalog with their status', () => {
    const [lobehubProvider] = getConnectorCatalog({ composio: false, lobehub: true });
    const lobehubId = lobehubProvider.type === 'lobehub' ? lobehubProvider.provider.id : '';
    const tools = listOfficialTools({
      connectedConnectorIds: new Set(['gmail', lobehubId]),
      enabledPlugins: ['gmail'],
      features: { composio: true, lobehubSkill: true },
    });

    const types = new Set(tools.map((t) => t.type));
    expect(types).toEqual(new Set(['builtin', 'composio', 'lobehub-skill']));
    expect(tools.find((t) => t.identifier === 'gmail')).toMatchObject({
      enabled: true,
      installed: true,
    });
    expect(tools.find((t) => t.identifier === lobehubId)).toMatchObject({
      installed: true,
      type: 'lobehub-skill',
    });
  });

  it('lists an uninstalled builtin as not installed so the builder does not pin it', async () => {
    const builtinId = listOfficialTools({
      connectedConnectorIds: new Set(),
      enabledPlugins: [],
      features: { composio: false, lobehubSkill: false },
    }).find((t) => t.type === 'builtin')!.identifier;

    const tools = listOfficialTools({
      connectedConnectorIds: new Set(),
      enabledPlugins: [],
      features: { composio: false, lobehubSkill: false },
      uninstalledBuiltinIds: new Set([builtinId]),
    });
    expect(tools.find((t) => t.identifier === builtinId)).toMatchObject({ installed: false });

    const facts = await gatherContextFacts(
      request({ editingAgentId: 'agt_edit', enabledToolIds: ['lobe-agent-builder'] }),
      {
        getAgentDefinition: async () => ({ plugins: [] }),
        listUninstalledBuiltinIds: async () => [builtinId],
      },
    );
    expect(
      facts.step.agentBuilderContext?.officialTools?.find((t) => t.identifier === builtinId),
    ).toMatchObject({ installed: false });
  });

  it('describes the workspace only when its slug resolves', async () => {
    const providers = {
      getWorkspaceContext: async (id?: string) => ({
        appUrl: 'https://x',
        slug: id ? undefined : undefined,
      }),
    };
    const personal = await gatherContextFacts(request({ workspaceId: undefined }), providers);
    expect(personal.step.workspaceContext).toEqual({ appUrl: 'https://x' });

    const unresolved = await gatherContextFacts(request({ workspaceId: 'ws_1' }), providers);
    expect(unresolved.step.workspaceContext).toBeUndefined();

    const resolved = await gatherContextFacts(request({ workspaceId: 'ws_1' }), {
      getWorkspaceContext: async () => ({ appUrl: 'https://x', slug: 'team' }),
    });
    expect(resolved.step.workspaceContext).toEqual({
      appUrl: 'https://x',
      workspace: { slug: 'team' },
    });
  });
});
