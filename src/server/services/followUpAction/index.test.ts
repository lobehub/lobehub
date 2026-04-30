// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import * as ModelRuntimeModule from '@/server/modules/ModelRuntime';

import { FollowUpActionService } from './index';

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(),
}));

const TEST_DB = {} as any;
const TEST_USER = 'user-1';
const TEST_MSG_ID = 'msg-1';

describe('FollowUpActionService.extract', () => {
  let svc: FollowUpActionService;
  let mockMessageModel: { findById: ReturnType<typeof vi.fn> };
  let mockAgentModel: { getAgentConfigById: ReturnType<typeof vi.fn> };
  let runtimeMock: { generateObject: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockMessageModel = { findById: vi.fn() };
    vi.mocked(MessageModel).mockImplementation(() => mockMessageModel as any);

    mockAgentModel = {
      getAgentConfigById: vi.fn().mockResolvedValue({ model: 'm', provider: 'p' }),
    };
    vi.mocked(AgentModel).mockImplementation(() => mockAgentModel as any);

    runtimeMock = { generateObject: vi.fn() };
    vi.spyOn(ModelRuntimeModule, 'initModelRuntimeFromDB').mockResolvedValue(runtimeMock as any);

    svc = new FollowUpActionService(TEST_DB, TEST_USER);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty when message not found', async () => {
    mockMessageModel.findById.mockResolvedValue(undefined);
    const result = await svc.extract({ messageId: TEST_MSG_ID, agentId: 'agent-1' });
    expect(result).toEqual({ messageId: TEST_MSG_ID, chips: [] });
    expect(runtimeMock.generateObject).not.toHaveBeenCalled();
  });

  it('returns empty when message role is not assistant', async () => {
    mockMessageModel.findById.mockResolvedValue({ role: 'user', content: 'hi' });
    const result = await svc.extract({ messageId: TEST_MSG_ID, agentId: 'agent-1' });
    expect(result.chips).toHaveLength(0);
    expect(runtimeMock.generateObject).not.toHaveBeenCalled();
  });

  it('returns empty when assistant content is blank', async () => {
    mockMessageModel.findById.mockResolvedValue({ role: 'assistant', content: '   ' });
    const result = await svc.extract({ messageId: TEST_MSG_ID, agentId: 'agent-1' });
    expect(result.chips).toHaveLength(0);
  });

  it('returns chips from a valid LLM JSON response', async () => {
    mockMessageModel.findById.mockResolvedValue({
      role: 'assistant',
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
      messageId: TEST_MSG_ID,
      agentId: 'agent-1',
      hint: { kind: 'onboarding', phase: 'agent_identity' },
    });
    expect(result.chips).toHaveLength(3);
    expect(result.chips[0].label).toBe('Lumi');
  });

  it('truncates more than 4 chips', async () => {
    mockMessageModel.findById.mockResolvedValue({ role: 'assistant', content: 'choose' });
    runtimeMock.generateObject.mockResolvedValue({
      chips: Array.from({ length: 6 }, (_, i) => ({ label: `c${i}`, message: `c${i}` })),
    });
    const result = await svc.extract({ messageId: TEST_MSG_ID, agentId: 'agent-1' });
    expect(result.chips).toHaveLength(4);
  });

  it('drops chips that exceed length limits but keeps the rest', async () => {
    mockMessageModel.findById.mockResolvedValue({ role: 'assistant', content: 'choose' });
    runtimeMock.generateObject.mockResolvedValue({
      chips: [
        { label: 'a'.repeat(50), message: 'too long label' },
        { label: 'ok', message: 'ok' },
      ],
    });
    const result = await svc.extract({ messageId: TEST_MSG_ID, agentId: 'agent-1' });
    expect(result.chips).toEqual([{ label: 'ok', message: 'ok' }]);
  });

  it('drops chips with empty label or message', async () => {
    mockMessageModel.findById.mockResolvedValue({ role: 'assistant', content: 'choose' });
    runtimeMock.generateObject.mockResolvedValue({
      chips: [
        { label: '', message: '' },
        { label: 'ok', message: 'ok' },
        { label: 'bad', message: '' },
      ],
    });
    const result = await svc.extract({ messageId: TEST_MSG_ID, agentId: 'agent-1' });
    expect(result.chips).toEqual([{ label: 'ok', message: 'ok' }]);
  });

  it('returns empty when LLM throws', async () => {
    mockMessageModel.findById.mockResolvedValue({ role: 'assistant', content: 'q?' });
    runtimeMock.generateObject.mockRejectedValue(new Error('boom'));
    const result = await svc.extract({ messageId: TEST_MSG_ID, agentId: 'agent-1' });
    expect(result.chips).toHaveLength(0);
  });

  it('returns empty when LLM response fails schema validation', async () => {
    mockMessageModel.findById.mockResolvedValue({ role: 'assistant', content: 'q?' });
    runtimeMock.generateObject.mockResolvedValue({ chips: 'not-an-array' });
    const result = await svc.extract({ messageId: TEST_MSG_ID, agentId: 'agent-1' });
    expect(result.chips).toHaveLength(0);
  });

  it('appends onboarding addendum to system prompt when hint is onboarding', async () => {
    mockMessageModel.findById.mockResolvedValue({ role: 'assistant', content: 'q?' });
    runtimeMock.generateObject.mockResolvedValue({ chips: [] });
    await svc.extract({
      messageId: TEST_MSG_ID,
      agentId: 'agent-1',
      hint: { kind: 'onboarding', phase: 'discovery' },
    });
    const passedMessages = runtimeMock.generateObject.mock.calls[0][0].messages;
    const sysContent = passedMessages.find((m: any) => m.role === 'system').content;
    expect(sysContent).toContain('Phase: discovery');
    expect(sysContent).toContain('Phase tip:');
  });

  it('falls back to system topic config when the agent has no model/provider', async () => {
    mockMessageModel.findById.mockResolvedValue({ role: 'assistant', content: 'q?' });
    runtimeMock.generateObject.mockResolvedValue({ chips: [] });
    mockAgentModel.getAgentConfigById.mockResolvedValue({ model: null, provider: null });
    await svc.extract({ messageId: TEST_MSG_ID, agentId: 'agent-1' });
    expect(runtimeMock.generateObject).toHaveBeenCalled();
  });
});
