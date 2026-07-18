import type { ISnapshotStore } from '@lobechat/agent-tracing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createUnderstandingOrchestrator } from './createOrchestrator';

const mocks = vi.hoisted(() => ({
  aiAgentConstructor: vi.fn(),
}));

vi.mock('@lobechat/builtin-agents', () => ({
  BUILTIN_AGENT_SLUGS: { onboardingUnderstanding: 'onboarding-understanding' },
}));

vi.mock('@lobechat/database', () => ({
  UnderstandingResourceNotFoundError: class extends Error {},
  UnderstandingResultRepository: class {},
  UnderstandingSessionRepository: class {},
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: class {
    getBuiltinAgent = vi.fn(async () => ({ id: 'understanding-agent' }));
  },
}));

vi.mock('@/database/models/agentOperation', () => ({ AgentOperationModel: class {} }));
vi.mock('@/database/models/message', () => ({ MessageModel: class {} }));
vi.mock('@/database/models/topic', () => ({ TopicModel: class {} }));
vi.mock('@/server/modules/AgentRuntime', () => ({
  AgentRuntimeCoordinator: class {
    deleteAgentOperation = vi.fn(async () => undefined);
  },
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    constructor(...args: unknown[]) {
      mocks.aiAgentConstructor(...args);
    }
  },
}));

vi.mock('./orchestrator', () => ({ UnderstandingOrchestrator: class {} }));
vi.mock('./providers', () => ({
  builtinUnderstandingProviderRegistrations: [],
  materializeUnderstandingProviders: () => ({ context: {}, registry: {} }),
}));
vi.mock('./sourceStore', () => ({ UnderstandingSourceStore: class {} }));

describe('createUnderstandingOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('injects a snapshot store that never persists raw Understanding inputs', async () => {
    await createUnderstandingOrchestrator({ db: {} as never, userId: 'user' });

    const options = mocks.aiAgentConstructor.mock.calls[0]?.[2] as
      { runtimeOptions?: { snapshotStore?: ISnapshotStore } } | undefined;
    const snapshotStore = options?.runtimeOptions?.snapshotStore;

    expect(snapshotStore).toBeDefined();
    await expect(snapshotStore!.save({} as never)).resolves.toBeUndefined();
    await expect(snapshotStore!.savePartial('operation', {})).resolves.toBeUndefined();
    await expect(snapshotStore!.removePartial('operation')).resolves.toBeUndefined();
    await expect(snapshotStore!.get('operation')).resolves.toBeNull();
    await expect(snapshotStore!.getLatest()).resolves.toBeNull();
    await expect(snapshotStore!.loadPartial('operation')).resolves.toBeNull();
    await expect(snapshotStore!.list()).resolves.toEqual([]);
    await expect(snapshotStore!.listPartials()).resolves.toEqual([]);
  });
});
