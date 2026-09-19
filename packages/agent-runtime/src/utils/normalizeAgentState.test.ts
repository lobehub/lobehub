import { describe, expect, it } from 'vitest';

import type { AgentState } from '../types';
import { normalizeAgentState } from './normalizeAgentState';

const baseState = (): AgentState =>
  ({
    cost: { total: 0 },
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-01-01T00:00:00.000Z',
    messages: [],
    operationId: 'op_1',
    status: 'idle',
    stepCount: 0,
    toolManifestMap: {},
    usage: {},
  }) as unknown as AgentState;

describe('normalizeAgentState', () => {
  it('returns the same object when metadata carries no legacy keys', () => {
    const state = { ...baseState(), metadata: { _stepLabel: 'step', work: { id: 'work_1' } } };
    expect(normalizeAgentState(state)).toBe(state);
  });

  it('lifts legacy metadata keys into world and binding and strips them from metadata', () => {
    const state = {
      ...baseState(),
      metadata: {
        activeDeviceId: 'dev_1',
        agentConfig: { systemRole: 'hi' },
        agentGroup: { agentMap: {} },
        botPlatformContext: { platformName: 'slack', supportsMarkdown: true },
        connectorOwnershipNote: 'note',
        devicePlatform: 'darwin',
        deviceSystemInfo: { workingDirectory: '/tmp' },
        discordContext: { guildId: 'g' },
        evalContext: { caseId: 'c' },
        projectInstructions: [{ content: 'x', source: 'AGENTS.md' }],
        searchDecision: { enabledSearch: true },
        userId: 'u1',
        userMemory: { enabled: true },
        userTimezone: 'Asia/Shanghai',
      },
    };

    const normalized = normalizeAgentState(state);

    expect(normalized.world).toEqual({
      agent: { systemRole: 'hi' },
      channel: {
        botPlatform: { platformName: 'slack', supportsMarkdown: true },
        discord: { guildId: 'g' },
      },
      connectorOwnershipNote: 'note',
      eval: { caseId: 'c' },
      group: { agentMap: {} },
      projectInstructions: [{ content: 'x', source: 'AGENTS.md' }],
      searchDecision: { enabledSearch: true },
      userMemory: { enabled: true },
      userTimezone: 'Asia/Shanghai',
    });
    expect(normalized.binding).toEqual({
      device: { id: 'dev_1', platform: 'darwin', systemInfo: { workingDirectory: '/tmp' } },
    });
    expect(normalized.origin).toEqual({ userId: 'u1' });
    expect(normalized.metadata).toEqual({});
    // Input is not mutated.
    expect(state.metadata.agentConfig).toEqual({ systemRole: 'hi' });
  });

  it('keeps slot values over legacy keys when both are present', () => {
    const state = {
      ...baseState(),
      binding: { device: { id: 'dev_new' } },
      metadata: { activeDeviceId: 'dev_old', agentConfig: { systemRole: 'old' } },
      world: { agent: { systemRole: 'new' } as any },
    };

    const normalized = normalizeAgentState(state);

    expect(normalized.world?.agent).toEqual({ systemRole: 'new' });
    expect(normalized.binding?.device?.id).toBe('dev_new');
    expect(normalized.metadata).toEqual({});
  });

  it('lifts identity, trigger and lineage keys into origin', () => {
    const state = {
      ...baseState(),
      metadata: {
        _stepLabel: 'step',
        agentId: 'agent-1',
        agentInterventionContinuation: {
          resolutionRequestId: 'r1',
          sourceOperationId: 'op-0',
          sourceToolMessageIds: ['t1'],
        },
        agentSignal: { kind: 'memory' },
        groupId: null,
        isSubAgent: true,
        orchestrationRole: 'member',
        sourceMessageId: 'msg-1',
        subAgentProgress: { parentOperationId: 'op-0', toolMessageId: 't1' },
        threadId: undefined,
        topicId: 'topic-1',
        trigger: 'chat',
        userId: 'u1',
        workspaceId: 'ws-1',
      },
    };

    const normalized = normalizeAgentState(state);

    expect(normalized.origin).toEqual({
      agentId: 'agent-1',
      continuation: {
        resolutionRequestId: 'r1',
        sourceOperationId: 'op-0',
        sourceToolMessageIds: ['t1'],
      },
      lineage: {
        isSubAgent: true,
        orchestrationRole: 'member',
        progressAnchor: { parentOperationId: 'op-0', toolMessageId: 't1' },
      },
      signal: { kind: 'memory' },
      sourceMessageId: 'msg-1',
      topicId: 'topic-1',
      trigger: 'chat',
      userId: 'u1',
      workspaceId: 'ws-1',
    });
    // `null` / `undefined` legacy values are absent, not carried as null.
    expect('groupId' in normalized.origin!).toBe(false);
    expect('threadId' in normalized.origin!).toBe(false);
    expect(normalized.metadata).toEqual({ _stepLabel: 'step' });
  });

  it('lifts principal, plan and host keys and folds the model config into its top-level slot', () => {
    const state = {
      ...baseState(),
      metadata: {
        _hooks: [{ id: 'h1', type: 'webhook', webhook: { url: 'https://x' } }],
        activeDeviceScope: 'workspace',
        agentShareVisitor: { shareId: 'share-1', visitorUserId: 'visitor-1' },
        botContext: { applicationId: 'app-1', isOwner: true, platform: 'discord' },
        clientIp: '10.0.0.1',
        deviceAccessPolicy: { canUseDevice: false, reason: 'external-bot' },
        evalRuntime: { caseId: 'case-1' },
        executionPlan: { kind: 'sandbox', target: 'sandbox' },
        modelRuntimeConfig: { model: 'gpt-4', provider: 'openai' },
        operationSkillSet: { enabledSkillIds: [], skills: [] },
        queueRetries: 3,
        queueRetryDelay: '10s',
        stream: false,
        userAgent: 'lh-cli',
        workingDirectory: '/repo',
      },
    };

    const normalized = normalizeAgentState(state);

    expect(normalized.principal).toEqual({
      actor: {
        bot: { applicationId: 'app-1', isOwner: true, platform: 'discord' },
        deviceScope: 'workspace',
        shareVisitor: { shareId: 'share-1', visitorUserId: 'visitor-1' },
      },
      audit: { clientIp: '10.0.0.1', userAgent: 'lh-cli' },
      policy: { deviceAccess: { canUseDevice: false, reason: 'external-bot' } },
    });
    expect(normalized.plan).toEqual({
      eval: { caseId: 'case-1' },
      execution: { kind: 'sandbox', target: 'sandbox' },
      skills: { enabledSkillIds: [], skills: [] },
      stream: false,
      workingDirectory: '/repo',
    });
    expect(normalized.host).toEqual({
      hooks: [{ id: 'h1', type: 'webhook', webhook: { url: 'https://x' } }],
      queue: { retries: 3, retryDelay: '10s' },
    });
    expect(normalized.modelRuntimeConfig).toEqual({ model: 'gpt-4', provider: 'openai' });
    expect(normalized.metadata).toEqual({});
  });

  it('keeps the top-level model config over the legacy metadata copy', () => {
    const state = {
      ...baseState(),
      metadata: { modelRuntimeConfig: { model: 'legacy', provider: 'openai' } },
      modelRuntimeConfig: { model: 'pinned', provider: 'openai' },
    };

    expect(normalizeAgentState(state).modelRuntimeConfig).toEqual({
      model: 'pinned',
      provider: 'openai',
    });
  });

  it('merges lifted origin keys into an existing origin without overriding it', () => {
    const state = {
      ...baseState(),
      metadata: { agentId: 'agent-old', topicId: 'topic-1' },
      origin: { agentId: 'agent-new' },
    };

    const normalized = normalizeAgentState(state);

    expect(normalized.origin).toEqual({ agentId: 'agent-new', topicId: 'topic-1' });
    expect(normalized.metadata).toEqual({});
  });

  it('lifts a partial device binding without inventing an id', () => {
    const state = {
      ...baseState(),
      metadata: { deviceSystemInfo: { workingDirectory: '/w' } },
    };

    const normalized = normalizeAgentState(state);

    expect(normalized.binding).toEqual({ device: { systemInfo: { workingDirectory: '/w' } } });
    expect(normalized.world).toBeUndefined();
  });
});
