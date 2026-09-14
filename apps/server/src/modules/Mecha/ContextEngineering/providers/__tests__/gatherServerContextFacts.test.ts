import { describe, expect, it, vi } from 'vitest';

import { gatherServerContextFacts } from '../index';
import { resolveSandboxVariables } from '../sandboxVariables';
import type { ServerContextFactInput } from '../types';

const {
  resolveAgentDocumentFacts,
  resolveCredsListVariable,
  resolveTopicReferenceFacts,
  resolveUserInfoVariables,
} = vi.hoisted(() => ({
  resolveAgentDocumentFacts: vi.fn(),
  resolveCredsListVariable: vi.fn(),
  resolveTopicReferenceFacts: vi.fn(),
  resolveUserInfoVariables: vi.fn(),
}));

vi.mock('../agentDocuments', () => ({ resolveAgentDocumentFacts }));
vi.mock('../credsList', () => ({ resolveCredsListVariable }));
vi.mock('../topicReferences', () => ({ resolveTopicReferenceFacts }));
vi.mock('../userInfoVariables', () => ({ resolveUserInfoVariables }));
vi.mock('../agentBuilderContext', () => ({ resolveAgentBuilderContextFacts: vi.fn() }));
vi.mock('../groupAgentBuilderContext', () => ({ resolveGroupAgentBuilderContextFacts: vi.fn() }));
vi.mock('../composioServices', () => ({ resolveComposioServicesVariable: vi.fn(async () => '') }));
vi.mock('../lobehubSkillVariables', () => ({
  resolveLobehubSkillVariables: vi.fn(async () => ({ agent_id: 'agt_1', topic_title: 'T' })),
}));
vi.mock('../onboardingContext', () => ({ resolveOnboardingContextFacts: vi.fn() }));
vi.mock('../planTodo', () => ({ resolvePlanTodoFacts: vi.fn() }));
vi.mock('../workspaceContext', () => ({ resolveWorkspaceContextFacts: vi.fn() }));

const input = (overrides: Partial<ServerContextFactInput> = {}): ServerContextFactInput => ({
  ctx: {} as never,
  enabledToolIds: [],
  messagesForContext: [],
  state: {} as never,
  ...overrides,
});

describe('gatherServerContextFacts', () => {
  it('runs the providers concurrently instead of one after another', async () => {
    const order: string[] = [];
    const slow = (name: string, ms: number, value: unknown) => async () => {
      order.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      order.push(`${name}:end`);
      return value;
    };
    resolveAgentDocumentFacts.mockImplementation(slow('docs', 20, [{ id: 'd1' }]));
    resolveCredsListVariable.mockImplementation(slow('creds', 5, 'creds'));
    resolveTopicReferenceFacts.mockImplementation(slow('refs', 10, [{ id: 't1' }]));
    resolveUserInfoVariables.mockResolvedValue({ language: 'zh-CN', username: 'arvin' });

    const facts = await gatherServerContextFacts(input());

    // Every provider started before the slowest one finished.
    expect(order.indexOf('creds:start')).toBeLessThan(order.indexOf('docs:end'));
    expect(order.indexOf('refs:start')).toBeLessThan(order.indexOf('docs:end'));
    expect(facts.agentDocuments).toEqual([{ id: 'd1' }]);
    expect(facts.step.topicReferences).toEqual([{ id: 't1' }]);
    expect(facts.variables).toMatchObject({
      CREDS_LIST: 'creds',
      agent_id: 'agt_1',
      language: 'zh-CN',
      topic_title: 'T',
      username: 'arvin',
    });
  });
});

describe('resolveSandboxVariables', () => {
  it('reports the sandbox reachable when no device is routed or the target is auto', async () => {
    const base = input({ ctx: { serverDB: undefined } as never });

    await expect(
      resolveSandboxVariables({ ...base, executionTarget: 'none' }),
    ).resolves.toMatchObject({ creds_sandbox_reachable: 'true', sandbox_enabled: 'false' });
    await expect(
      resolveSandboxVariables({ ...base, activeDeviceId: 'dev-1', executionTarget: 'auto' }),
    ).resolves.toMatchObject({ creds_sandbox_reachable: 'true' });
    await expect(
      resolveSandboxVariables({ ...base, activeDeviceId: 'dev-1', executionTarget: 'device' }),
    ).resolves.toMatchObject({ creds_sandbox_reachable: 'false' });
    await expect(
      resolveSandboxVariables({ ...base, enabledToolIds: ['lobe-cloud-sandbox'] }),
    ).resolves.toMatchObject({ sandbox_enabled: 'true', sandbox_uploaded_files: '' });
  });
});
