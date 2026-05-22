// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as ModelRuntimeModule from '@/server/modules/ModelRuntime';

import { FollowUpActionService } from './index';

const TEST_USER = 'user-1';
const TEST_TOPIC = 'topic-1';
const FOUND_MSG = 'msg-real';
const MODEL_CONFIG = {
  model: 'scene-model',
  provider: 'scene-provider',
};

describe('FollowUpActionService.extract', () => {
  let svc: FollowUpActionService;
  let dbMock: any;
  let runtimeMock: { generateObject: ReturnType<typeof vi.fn> };
  let queryFindFirstSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryFindFirstSpy = vi.fn();
    dbMock = {
      query: {
        messages: {
          findFirst: queryFindFirstSpy,
        },
      },
    };

    runtimeMock = { generateObject: vi.fn() };
    vi.spyOn(ModelRuntimeModule, 'initModelRuntimeFromDB').mockResolvedValue(runtimeMock as any);

    svc = new FollowUpActionService(dbMock, TEST_USER);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty (with empty messageId) when no eligible assistant message found', async () => {
    queryFindFirstSpy.mockResolvedValue(undefined);
    const result = await svc.extract({ modelConfig: MODEL_CONFIG, topicId: TEST_TOPIC });
    expect(result).toEqual({ chips: [], messageId: '' });
    expect(runtimeMock.generateObject).not.toHaveBeenCalled();
  });

  it('returns chips from a valid LLM JSON response, keyed by resolved message id', async () => {
    queryFindFirstSpy.mockResolvedValue({
      id: FOUND_MSG,
      content: 'What would you like to call me?',
    });
    runtimeMock.generateObject.mockResolvedValue({
      chips: [
        { label: 'Lumi', message: 'Lumi' },
        { label: 'Atlas', message: 'Atlas' },
        { label: 'You pick one', message: 'You pick one for me' },
      ],
    });
    const result = await svc.extract({
      topicId: TEST_TOPIC,
      hint: { kind: 'onboarding', phase: 'agent_identity' },
      modelConfig: MODEL_CONFIG,
    });
    expect(result.messageId).toBe(FOUND_MSG);
    expect(result.chips).toHaveLength(3);
    expect(result.chips[0].label).toBe('Lumi');
  });

  it('uses the caller-provided scene model config for extraction', async () => {
    queryFindFirstSpy.mockResolvedValue({
      id: FOUND_MSG,
      content: 'What would you like to call me?',
    });
    runtimeMock.generateObject.mockResolvedValue({ chips: [] });

    await svc.extract({
      topicId: TEST_TOPIC,
      modelConfig: {
        model: 'custom-scene-model',
        provider: 'custom-provider',
      },
    });

    expect(ModelRuntimeModule.initModelRuntimeFromDB).toHaveBeenCalledWith(
      dbMock,
      TEST_USER,
      'custom-provider',
    );
    expect(runtimeMock.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'custom-scene-model',
      }),
    );
  });

  it('truncates more than 4 chips', async () => {
    queryFindFirstSpy.mockResolvedValue({ id: FOUND_MSG, content: 'choose' });
    runtimeMock.generateObject.mockResolvedValue({
      chips: Array.from({ length: 6 }, (_, i) => ({ label: `c${i}`, message: `c${i}` })),
    });
    const result = await svc.extract({ modelConfig: MODEL_CONFIG, topicId: TEST_TOPIC });
    expect(result.chips).toHaveLength(4);
  });

  it('drops chips that exceed length limits but keeps the rest', async () => {
    queryFindFirstSpy.mockResolvedValue({ id: FOUND_MSG, content: 'choose' });
    runtimeMock.generateObject.mockResolvedValue({
      chips: [
        { label: 'a'.repeat(50), message: 'too long label' },
        { label: 'ok', message: 'ok' },
      ],
    });
    const result = await svc.extract({ modelConfig: MODEL_CONFIG, topicId: TEST_TOPIC });
    expect(result.chips).toEqual([{ label: 'ok', message: 'ok' }]);
  });

  it('drops chips with empty label or message', async () => {
    queryFindFirstSpy.mockResolvedValue({ id: FOUND_MSG, content: 'choose' });
    runtimeMock.generateObject.mockResolvedValue({
      chips: [
        { label: '', message: '' },
        { label: 'ok', message: 'ok' },
        { label: 'bad', message: '' },
      ],
    });
    const result = await svc.extract({ modelConfig: MODEL_CONFIG, topicId: TEST_TOPIC });
    expect(result.chips).toEqual([{ label: 'ok', message: 'ok' }]);
  });

  it('returns empty (with messageId) when LLM throws', async () => {
    queryFindFirstSpy.mockResolvedValue({ id: FOUND_MSG, content: 'q?' });
    runtimeMock.generateObject.mockRejectedValue(new Error('boom'));
    const result = await svc.extract({ modelConfig: MODEL_CONFIG, topicId: TEST_TOPIC });
    expect(result).toEqual({ chips: [], messageId: FOUND_MSG });
  });

  it('returns empty (with messageId) when LLM response fails schema validation', async () => {
    queryFindFirstSpy.mockResolvedValue({ id: FOUND_MSG, content: 'q?' });
    runtimeMock.generateObject.mockResolvedValue({ chips: 'not-an-array' });
    const result = await svc.extract({ modelConfig: MODEL_CONFIG, topicId: TEST_TOPIC });
    expect(result).toEqual({ chips: [], messageId: FOUND_MSG });
  });

  const captureWhereOps = () => {
    const arg = queryFindFirstSpy.mock.calls[0][0];
    const fakeTable = {
      content: { col: 'content' },
      createdAt: { col: 'createdAt' },
      id: { col: 'id' },
      role: { col: 'role' },
      threadId: { col: 'threadId' },
      topicId: { col: 'topicId' },
      userId: { col: 'userId' },
    };
    const ops = {
      and: (...parts: any[]) => ({ op: 'and', parts }),
      eq: (col: any, value: any) => ({ col, op: 'eq', value }),
      isNotNull: (col: any) => ({ col, op: 'isNotNull' }),
      isNull: (col: any) => ({ col, op: 'isNull' }),
      ne: (col: any, value: any) => ({ col, op: 'ne', value }),
    };
    const result = arg.where(fakeTable, ops);
    return { parts: result.parts as any[], table: fakeTable };
  };

  it('filters by threadId when provided (thread isolation)', async () => {
    queryFindFirstSpy.mockResolvedValue(undefined);
    await svc.extract({
      modelConfig: MODEL_CONFIG,
      threadId: 'thread-A',
      topicId: TEST_TOPIC,
    });
    const { parts, table } = captureWhereOps();
    expect(parts).toContainEqual({ col: table.threadId, op: 'eq', value: 'thread-A' });
    expect(parts.some((p) => p.op === 'isNull' && p.col === table.threadId)).toBe(false);
  });

  it('filters by isNull(threadId) when no threadId provided (main topic only)', async () => {
    queryFindFirstSpy.mockResolvedValue(undefined);
    await svc.extract({ modelConfig: MODEL_CONFIG, topicId: TEST_TOPIC });
    const { parts, table } = captureWhereOps();
    expect(parts).toContainEqual({ col: table.threadId, op: 'isNull' });
    expect(parts.some((p) => p.op === 'eq' && p.col === table.threadId)).toBe(false);
  });

  it('appends onboarding addendum to system prompt when hint is onboarding', async () => {
    queryFindFirstSpy.mockResolvedValue({ id: FOUND_MSG, content: 'q?' });
    runtimeMock.generateObject.mockResolvedValue({ chips: [] });
    await svc.extract({
      topicId: TEST_TOPIC,
      hint: { kind: 'onboarding', phase: 'discovery' },
      modelConfig: MODEL_CONFIG,
    });
    const passedMessages = runtimeMock.generateObject.mock.calls[0][0].messages;
    const sysContent = passedMessages.find((m: any) => m.role === 'system').content;
    expect(sysContent).toContain('Phase: discovery');
    expect(sysContent).toContain('Phase tip:');
  });
});
