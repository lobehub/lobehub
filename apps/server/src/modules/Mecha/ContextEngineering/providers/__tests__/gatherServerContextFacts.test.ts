import { describe, expect, it, vi } from 'vitest';

import { gatherServerContextFacts, PROVIDER_CONCURRENCY } from '../index';
import { resolveSandboxVariables } from '../sandboxVariables';
import type { ServerContextFactInput } from '../types';

const mocks = vi.hoisted(() => {
  const names = [
    'resolveAgentBuilderContextFacts',
    'resolveAgentDocumentFacts',
    'resolveComposioServicesVariable',
    'resolveCredsListVariable',
    'resolveGroupAgentBuilderContextFacts',
    'resolveLobehubSkillVariables',
    'resolveOnboardingContextFacts',
    'resolvePlanTodoFacts',
    'resolveTopicReferenceFacts',
    'resolveUserInfoVariables',
    'resolveWorkspaceContextFacts',
  ] as const;
  return Object.fromEntries(names.map((name) => [name, vi.fn()])) as Record<
    (typeof names)[number],
    ReturnType<typeof vi.fn>
  >;
});

vi.mock('../agentBuilderContext', () => ({
  resolveAgentBuilderContextFacts: mocks.resolveAgentBuilderContextFacts,
}));
vi.mock('../agentDocuments', () => ({
  resolveAgentDocumentFacts: mocks.resolveAgentDocumentFacts,
}));
vi.mock('../composioServices', () => ({
  resolveComposioServicesVariable: mocks.resolveComposioServicesVariable,
}));
vi.mock('../credsList', () => ({ resolveCredsListVariable: mocks.resolveCredsListVariable }));
vi.mock('../groupAgentBuilderContext', () => ({
  resolveGroupAgentBuilderContextFacts: mocks.resolveGroupAgentBuilderContextFacts,
}));
vi.mock('../lobehubSkillVariables', () => ({
  resolveLobehubSkillVariables: mocks.resolveLobehubSkillVariables,
}));
vi.mock('../onboardingContext', () => ({
  resolveOnboardingContextFacts: mocks.resolveOnboardingContextFacts,
}));
vi.mock('../planTodo', () => ({ resolvePlanTodoFacts: mocks.resolvePlanTodoFacts }));
vi.mock('../topicReferences', () => ({
  resolveTopicReferenceFacts: mocks.resolveTopicReferenceFacts,
}));
vi.mock('../userInfoVariables', () => ({
  resolveUserInfoVariables: mocks.resolveUserInfoVariables,
}));
vi.mock('../workspaceContext', () => ({
  resolveWorkspaceContextFacts: mocks.resolveWorkspaceContextFacts,
}));

const input = (overrides: Partial<ServerContextFactInput> = {}): ServerContextFactInput => ({
  ctx: {} as never,
  enabledToolIds: [],
  messagesForContext: [],
  state: {} as never,
  ...overrides,
});

describe('gatherServerContextFacts', () => {
  it('overlaps the providers but never runs more than the cap at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const slow = (value: unknown) => async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return value;
    };
    for (const mock of Object.values(mocks)) mock.mockImplementation(slow(undefined));
    mocks.resolveAgentDocumentFacts.mockImplementation(slow([{ id: 'd1' }]));
    mocks.resolveCredsListVariable.mockImplementation(slow('creds'));
    mocks.resolveTopicReferenceFacts.mockImplementation(slow([{ id: 't1' }]));
    mocks.resolveLobehubSkillVariables.mockImplementation(
      slow({ agent_id: 'agt_1', topic_title: 'T' }),
    );
    mocks.resolveUserInfoVariables.mockImplementation(
      slow({ language: 'zh-CN', username: 'arvin' }),
    );

    const facts = await gatherServerContextFacts(input());

    // Eleven slow providers (the sandbox one is real and returns at once),
    // eight at a time: bounded, but still overlapping.
    expect(maxInFlight).toBe(PROVIDER_CONCURRENCY);
    expect(facts.agentDocuments).toEqual([{ id: 'd1' }]);
    expect(facts.step.topicReferences).toEqual([{ id: 't1' }]);
    expect(facts.variables).toMatchObject({
      CREDS_LIST: 'creds',
      agent_id: 'agt_1',
      language: 'zh-CN',
      sandbox_enabled: 'false',
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
