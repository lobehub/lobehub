/**
 * @vitest-environment node
 *
 * Protocol v2 message patches across an inline step loop: a step that continues
 * in the same invocation leaves its patch to the next step's entry read instead
 * of reading the conversation again when it ends.
 */
import type { UIChatMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentExecutionParams, DeferredMessagePatch } from '../../types';
import { AgentRuntimeService } from '..';
import { stepMessagesScopeKey } from '../executeStep/messagePatch';
import { stubRunningDurableOperation } from './testUtils';

vi.mock('@lobechat/model-runtime', (...args) =>
  import('./testUtils').then((m) =>
    (m.lobechatModelRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: vi.fn() }));

vi.mock('@/libs/trusted-client', (...args) =>
  import('./testUtils').then((m) => (m.libsTrustedClientModule as (...a: any[]) => any)(...args)),
);

vi.mock('@/server/services/file', (...args) =>
  import('./testUtils').then((m) => (m.serverServicesFileModule as (...a: any[]) => any)(...args)),
);

vi.mock('@/database/models/message', (...args) =>
  import('./testUtils').then((m) =>
    (m.databaseModelsMessageModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/database/models/agent', (...args) =>
  import('./testUtils').then((m) => (m.databaseModelsAgentModule as (...a: any[]) => any)(...args)),
);

vi.mock('@/database/models/plugin', (...args) =>
  import('./testUtils').then((m) =>
    (m.databaseModelsPluginModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/server/modules/ModelRuntime', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesModelRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/server/services/search', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverServicesSearchModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/server/modules/AgentRuntime/factory', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesAgentRuntimeFactoryModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/server/modules/AgentRuntime/redis', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesAgentRuntimeRedisModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/server/modules/AgentRuntime', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesAgentRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@lobechat/agent-runtime', (...args) =>
  import('./testUtils').then((m) =>
    (m.lobechatAgentRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/server/services/queue', (...args) =>
  import('./testUtils').then((m) => (m.serverServicesQueueModule as (...a: any[]) => any)(...args)),
);

vi.mock('@/server/modules/Mecha', (...args) =>
  import('./testUtils').then((m) => (m.serverModulesMechaModule as (...a: any[]) => any)(...args)),
);

vi.mock('model-bank', (...args) =>
  import('./testUtils').then((m) => (m.modelBankModule as (...a: any[]) => any)(...args)),
);

const OPERATION_ID = 'op-message-patch';
const USER_ID = 'user-1';

const context = {
  payload: { isFirstMessage: false, message: { content: 'test' }, sessionId: OPERATION_ID },
  phase: 'user_input',
  session: { messageCount: 1, sessionId: OPERATION_ID, status: 'running', stepCount: 1 },
} as AgentExecutionParams['context'];

const row = (id: string, content: string, role: UIChatMessage['role'] = 'user') =>
  ({ content, createdAt: 1, id, role, updatedAt: 1 }) as UIChatMessage;

const runState = (overrides: Record<string, unknown> = {}) => ({
  events: [],
  // Protocol 2: the client reconciles through `message_patch` revisions.
  host: { clientProtocol: 2 },
  lastModified: new Date().toISOString(),
  messages: [],
  operationId: OPERATION_ID,
  origin: { agentId: 'agt_1', topicId: 'tpc_1' },
  status: 'running',
  stepCount: 1,
  ...overrides,
});

/** What step 1 leaves behind when it continues inline. */
const pendingPatch = (state = runState({ stepCount: 2 })): DeferredMessagePatch => ({
  before: [row('u1', 'question')],
  scopeKey: stepMessagesScopeKey(state as any),
  state: state as any,
  stepIndex: 1,
});

const spyAll = (target: any) => {
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(target))) {
    if (key !== 'constructor' && typeof target[key] === 'function') vi.spyOn(target, key);
  }
};

const buildService = (options?: ConstructorParameters<typeof AgentRuntimeService>[2]) => {
  const service = new AgentRuntimeService({} as any, USER_ID, options);
  const coordinator = (service as any).coordinator;
  const streamManager = (service as any).streamManager;
  const queueService = (service as any).queueService;
  spyAll(coordinator);
  spyAll(streamManager);
  coordinator.getOperationMetadata.mockResolvedValue({ status: 'running', userId: USER_ID });
  coordinator.saveInlineResume.mockResolvedValue(true);

  // The topic read every step starts with.
  const query = vi.fn().mockResolvedValue([]);
  (service as any).messageModel.query = query;
  vi.spyOn((service as any).messageService, 'prepareUiMessages').mockImplementation(
    async (messages: any) => messages.map((message: UIChatMessage) => ({ ...message })),
  );
  // The read a step makes when it ends.
  const queryUiMessages = vi.spyOn(service, 'queryUiMessages');

  const step = vi.fn().mockImplementation(async (input: any) => ({
    events: [],
    newState: { ...input, stepCount: input.stepCount + 1 },
    nextContext: context,
  }));
  vi.spyOn(service as any, 'createAgentRuntime').mockResolvedValue({ runtime: { step } });

  const events = () =>
    streamManager.publishStreamEvent.mock.calls.map(([, event]: any[]) => event) as any[];
  const indexOf = (type: string, stepIndex: number) =>
    events().findIndex((event) => event.type === type && event.stepIndex === stepIndex);

  return {
    coordinator,
    events,
    indexOf,
    query,
    queryUiMessages,
    queueService,
    service,
    step,
    streamManager,
  };
};

const inlineStep = (stepIndex: number, extra: Partial<AgentExecutionParams> = {}) => ({
  context,
  inlineContinuation: true,
  operationId: OPERATION_ID,
  stepIndex,
  ...extra,
});

describe('AgentRuntimeService.executeStep - message patches across inline steps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubRunningDurableOperation();
    process.env.AGENT_RUNTIME_BASE_URL = 'http://localhost:3010';
  });

  afterEach(() => {
    delete process.env.AGENT_RUNTIME_BASE_URL;
  });

  it("completes a continuing step's patch from the next step's entry read", async () => {
    const { coordinator, events, indexOf, query, queryUiMessages, queueService, service, step } =
      buildService();
    coordinator.loadAgentState.mockResolvedValueOnce(runState());
    query.mockResolvedValueOnce([row('u1', 'question')]);

    const first = await service.executeStep(inlineStep(1));

    expect(first.continuation?.stepIndex).toBe(2);
    expect(first.deferredMessagePatch).toMatchObject({
      before: [row('u1', 'question')],
      stepIndex: 1,
    });
    expect(events().some((event) => event.type === 'message_patch')).toBe(false);
    expect(queueService.scheduleMessage).not.toHaveBeenCalled();

    // Written between the two steps: the user edits the question and a task
    // reports back into the topic.
    coordinator.loadAgentState.mockResolvedValueOnce(runState({ stepCount: 2 }));
    query.mockResolvedValueOnce([
      row('u1', 'edited question'),
      row('cb1', 'task finished', 'taskCallback'),
    ]);

    const second = await service.executeStep(
      inlineStep(2, { deferredMessagePatch: first.deferredMessagePatch }),
    );

    // Step 1's patch goes out ahead of step 2's `step_start`, which the client
    // checks against the last revision it applied.
    const patchAt = indexOf('message_patch', 1);
    expect(patchAt).toBeGreaterThan(-1);
    expect(patchAt).toBeLessThan(indexOf('step_start', 2));
    expect(events()[patchAt].data).toMatchObject({
      deletes: [],
      revision: 2,
      upserts: [
        { afterId: null, message: { content: 'edited question', id: 'u1' } },
        { afterId: 'u1', message: { content: 'task finished', id: 'cb1' } },
      ],
    });
    // One topic read per step, and none when either step ended.
    expect(query).toHaveBeenCalledTimes(2);
    expect(queryUiMessages).not.toHaveBeenCalled();
    // The model works from the same read the client was sent.
    expect(JSON.stringify(step.mock.calls[1][0].messages)).toContain('edited question');
    expect(second.deferredMessagePatch?.stepIndex).toBe(2);
  });

  it('reads the conversation itself when the next step reads another one', async () => {
    const { coordinator, events, indexOf, query, queryUiMessages, service } = buildService();
    const patch = pendingPatch();
    coordinator.loadAgentState.mockResolvedValueOnce(
      runState({ origin: { agentId: 'agt_1', topicId: 'tpc_other' }, stepCount: 2 }),
    );
    query.mockResolvedValueOnce([row('x1', 'another topic')]);
    queryUiMessages.mockResolvedValueOnce([
      row('u1', 'question'),
      row('a1', 'answer', 'assistant'),
    ]);

    await service.executeStep(inlineStep(2, { deferredMessagePatch: patch }));

    expect(queryUiMessages).toHaveBeenCalledWith(patch.state, {
      skipCompressedMembers: true,
      skipWorks: true,
      viewModelPluginState: true,
    });
    const patchAt = indexOf('message_patch', 1);
    expect(patchAt).toBeLessThan(indexOf('step_start', 2));
    expect(events()[patchAt].data).toMatchObject({
      deletes: [],
      upserts: [{ afterId: 'u1', message: { id: 'a1' } }],
    });
  });

  it('publishes the patch before queueing when the next step cannot stay inline', async () => {
    const {
      coordinator,
      events,
      indexOf,
      query,
      queryUiMessages,
      queueService,
      service,
      streamManager,
    } = buildService();
    coordinator.loadAgentState.mockResolvedValueOnce(runState());
    coordinator.saveInlineResume.mockResolvedValue(false);
    query.mockResolvedValueOnce([row('u1', 'question')]);
    queryUiMessages.mockResolvedValueOnce([
      row('u1', 'question'),
      row('a1', 'answer', 'assistant'),
    ]);

    const result = await service.executeStep(inlineStep(1));

    expect(result.nextStepScheduled).toBe(true);
    expect(result.deferredMessagePatch).toBeUndefined();
    expect(queryUiMessages).toHaveBeenCalledWith(expect.objectContaining({ stepCount: 2 }), {
      skipCompressedMembers: true,
      skipWorks: true,
      viewModelPluginState: true,
    });
    const patchAt = indexOf('message_patch', 1);
    expect(events()[patchAt].data).toMatchObject({
      upserts: [{ afterId: 'u1', message: { id: 'a1' } }],
    });
    // Another invocation may start the queued step at once.
    expect(streamManager.publishStreamEvent.mock.invocationCallOrder[patchAt]).toBeLessThan(
      queueService.scheduleMessage.mock.invocationCallOrder[0],
    );
  });

  it('publishes a handed-on patch ahead of the failure when the next step throws', async () => {
    const { coordinator, events, queryUiMessages, service } = buildService();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    coordinator.loadAgentState.mockRejectedValueOnce(new Error('state store unavailable'));
    queryUiMessages.mockResolvedValueOnce([
      row('u1', 'question'),
      row('a1', 'answer', 'assistant'),
    ]);

    await expect(
      service.executeStep(inlineStep(2, { deferredMessagePatch: pendingPatch() })),
    ).rejects.toThrow('state store unavailable');

    const types = events().map((event) => event.type);
    expect(types[0]).toBe('message_patch');
    expect(types).toContain('error');
  });

  it('publishes and drains a handed-on patch when another worker holds the step', async () => {
    const { coordinator, events, queryUiMessages, service, streamManager } = buildService();
    coordinator.tryClaimStep.mockResolvedValue(false);
    // This exit skips the step's `finally`, the usual drain point.
    streamManager.drainPushes = vi.fn().mockResolvedValue(undefined);
    queryUiMessages.mockResolvedValueOnce([
      row('u1', 'question'),
      row('a1', 'answer', 'assistant'),
    ]);

    await service.executeStep(inlineStep(2, { deferredMessagePatch: pendingPatch() }));

    const patchAt = events().findIndex((event) => event.type === 'message_patch');
    expect(patchAt).toBeGreaterThan(-1);
    expect(streamManager.publishStreamEvent.mock.invocationCallOrder[patchAt]).toBeLessThan(
      streamManager.drainPushes.mock.invocationCallOrder[0],
    );
  });

  it('publishes a handed-on patch before a pending init writes the turn', async () => {
    const runDeferredInit = vi.fn().mockRejectedValue(new Error('init failed'));
    const { coordinator, queryUiMessages, service } = buildService({
      delegate: { runDeferredInit } as any,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    coordinator.loadAgentState.mockResolvedValue(
      runState({ request: { approvedToolEntries: [], selectedToolIds: [] }, stepCount: 2 }),
    );
    queryUiMessages.mockResolvedValueOnce([row('u1', 'question')]);

    await expect(
      service.executeStep(inlineStep(2, { deferredMessagePatch: pendingPatch() })),
    ).rejects.toThrow('init failed');

    expect(runDeferredInit).toHaveBeenCalled();
    expect(queryUiMessages.mock.invocationCallOrder[0]).toBeLessThan(
      runDeferredInit.mock.invocationCallOrder[0],
    );
  });

  it.each([
    {
      name: 'a step that finishes the run',
      params: inlineStep(1),
      status: 'done',
    },
    {
      name: 'a continuing step that is not inlined',
      params: { context, operationId: OPERATION_ID, stepIndex: 1 },
      status: 'running',
    },
  ])('still reads the conversation when $name ends', async ({ params, status }) => {
    const { coordinator, events, indexOf, query, queryUiMessages, service, step } = buildService();
    coordinator.loadAgentState.mockResolvedValueOnce(runState());
    query.mockResolvedValueOnce([row('u1', 'question')]);
    queryUiMessages.mockResolvedValueOnce([
      row('u1', 'question'),
      row('a1', 'answer', 'assistant'),
    ]);
    step.mockImplementationOnce(async (input: any) => ({
      events: [],
      newState: { ...input, status, stepCount: 2 },
      nextContext: status === 'running' ? context : undefined,
    }));

    const result = await service.executeStep(params);

    expect(result.deferredMessagePatch).toBeUndefined();
    expect(queryUiMessages).toHaveBeenCalledTimes(1);
    expect(events()[indexOf('message_patch', 1)].data).toMatchObject({
      upserts: [{ afterId: 'u1', message: { id: 'a1' } }],
    });
  });

  it('leaves a client without message patches untouched', async () => {
    const { coordinator, events, query, queryUiMessages, service } = buildService();
    coordinator.loadAgentState.mockResolvedValueOnce(runState({ host: {} }));
    query.mockResolvedValueOnce([row('u1', 'question')]);

    const result = await service.executeStep(inlineStep(1));

    expect(result.continuation?.stepIndex).toBe(2);
    expect(result.deferredMessagePatch).toBeUndefined();
    expect(queryUiMessages).not.toHaveBeenCalled();
    expect(events().some((event) => event.type === 'message_patch')).toBe(false);
  });
});

describe('AgentRuntimeService.scheduleContinuation - handed-back message patch', () => {
  const continuation = {
    context,
    delay: 50,
    operationId: OPERATION_ID,
    priority: 'normal' as const,
    stepIndex: 2,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENT_RUNTIME_BASE_URL = 'http://localhost:3010';
  });

  afterEach(() => {
    delete process.env.AGENT_RUNTIME_BASE_URL;
  });

  it('publishes the patch before the step is queued', async () => {
    const { events, indexOf, queryUiMessages, queueService, service, streamManager } =
      buildService();
    queryUiMessages.mockResolvedValueOnce([
      row('u1', 'question'),
      row('a1', 'answer', 'assistant'),
    ]);

    await service.scheduleContinuation(continuation, pendingPatch());

    const patchAt = indexOf('message_patch', 1);
    expect(events()[patchAt].data).toMatchObject({
      revision: 2,
      upserts: [{ afterId: 'u1', message: { id: 'a1' } }],
    });
    expect(streamManager.publishStreamEvent.mock.invocationCallOrder[patchAt]).toBeLessThan(
      queueService.scheduleMessage.mock.invocationCallOrder[0],
    );
  });

  it('still queues the step when the patch cannot be read', async () => {
    const { events, queryUiMessages, queueService, service } = buildService();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    queryUiMessages.mockRejectedValueOnce(new Error('database unavailable'));

    await service.scheduleContinuation(continuation, pendingPatch());

    expect(events().some((event) => event.type === 'message_patch')).toBe(false);
    expect(queueService.scheduleMessage).toHaveBeenCalledTimes(1);
  });
});

describe('AgentRuntimeService.executeStep - compression groups in step reads', () => {
  const group = (content: string, compressedMessages: UIChatMessage[] = []) =>
    ({ ...row('g1', content, 'compressedGroup'), compressedMessages }) as UIChatMessage;
  const member = row('m1', 'ORIGINAL MESSAGE');

  const patches = (events: () => any[]) =>
    events()
      .filter((event) => event.type === 'message_patch')
      .map((event) => event.data);

  beforeEach(() => {
    vi.clearAllMocks();
    stubRunningDurableOperation();
    process.env.AGENT_RUNTIME_BASE_URL = 'http://localhost:3010';
  });

  afterEach(() => {
    delete process.env.AGENT_RUNTIME_BASE_URL;
  });

  it('reads without members only for a run that receives message patches', async () => {
    const { coordinator, query, service } = buildService();
    coordinator.loadAgentState
      .mockResolvedValueOnce(runState())
      .mockResolvedValueOnce(runState({ host: {} }));

    await service.executeStep(inlineStep(1));
    await service.executeStep(inlineStep(1));

    expect(query.mock.calls[0][0]).toMatchObject({ skipCompressedMembers: true });
    expect(query.mock.calls[1][0]).toMatchObject({ skipCompressedMembers: false });
  });

  // The patch is diffed after projection, so a projected-away payload never
  // has to leave the database; a protocol-1 snapshot is rendered unprojected.
  it('reads projected-away tool payloads only for a run that receives message patches', async () => {
    const { coordinator, query, service } = buildService();
    coordinator.loadAgentState
      .mockResolvedValueOnce(runState())
      .mockResolvedValueOnce(runState({ host: {} }));

    await service.executeStep(inlineStep(1));
    await service.executeStep(inlineStep(1));

    expect(query.mock.calls[0][0]).toMatchObject({ viewModelPluginState: true });
    expect(query.mock.calls[1][0]).toMatchObject({ viewModelPluginState: false });
  });

  it('ships a group the step changed with its members', async () => {
    const { coordinator, events, query, queryUiMessages, service } = buildService();
    coordinator.loadAgentState.mockResolvedValueOnce(runState({ stepCount: 2 }));
    query.mockResolvedValueOnce([group('new summary')]);
    queryUiMessages.mockResolvedValueOnce([group('new summary', [member])]);

    await service.executeStep(
      inlineStep(2, {
        deferredMessagePatch: { ...pendingPatch(), before: [group('old summary')] },
      }),
    );

    expect(queryUiMessages).toHaveBeenCalledWith(expect.anything(), { skipWorks: true });
    const [patch] = patches(events);
    expect(patch.upserts).toHaveLength(1);
    expect(patch.upserts[0].message).toMatchObject({
      compressedMessages: [member],
      content: 'new summary',
    });
  });

  it('ships no patch when the members cannot be read', async () => {
    const { coordinator, events, query, queryUiMessages, service } = buildService();
    coordinator.loadAgentState.mockResolvedValueOnce(runState({ stepCount: 2 }));
    query.mockResolvedValueOnce([group('new summary')]);
    queryUiMessages.mockResolvedValueOnce(undefined);

    await service.executeStep(
      inlineStep(2, {
        deferredMessagePatch: { ...pendingPatch(), before: [group('old summary')] },
      }),
    );

    expect(patches(events).filter((patch) => patch.revision === 2)).toEqual([]);
  });
});
