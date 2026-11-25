// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { aiChatRouter } from '../aiChat';

vi.mock('@/database/models/agent');
vi.mock('@/database/models/message');
vi.mock('@/database/models/thread');
vi.mock('@/database/repositories/topic');
vi.mock('@/server/services/aiChat');
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(),
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

/**
 * Billing attribution (`agentShare`, `billingAgentId`) decides who pays for a
 * call, so client metadata must never carry it into the model runtime.
 */
const forgedOrigin = {
  agentShare: { agentId: 'agt_x', shareId: 'share-x', visitorUserId: 'visitor-x' },
  billingAgentId: 'agt_x',
  scenario: 'kept',
};

describe('aiChatRouter client metadata', () => {
  it('drops server-only spend attribution from outputJSON metadata', async () => {
    const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
    const generateObject = vi.fn().mockResolvedValue({ object: {} });
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ generateObject } as any);

    const caller = aiChatRouter.createCaller({ serverDB: {}, userId: 'u1' } as any);
    await caller.outputJSON({
      messages: [{ content: 'test', role: 'user' }],
      metadata: forgedOrigin,
      model: 'gpt-4o',
      provider: 'lobehub',
      schema: { name: 'Empty', schema: { properties: {}, type: 'object' as const } },
    });

    const { metadata } = generateObject.mock.calls[0][1];
    expect(metadata).toMatchObject({ scenario: 'kept', trigger: 'chat' });
    expect(metadata).not.toHaveProperty('billingAgentId');
    expect(metadata).not.toHaveProperty('agentShare');
  });

  it('drops server-only spend attribution from decide metadata', async () => {
    const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
    const decide = vi.fn().mockResolvedValue({ answers: {}, model: 'jev-1.14.0' });
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ decide } as any);

    const caller = aiChatRouter.createCaller({ serverDB: {}, userId: 'u1' } as any);
    await caller.decide({
      metadata: forgedOrigin,
      model: 'jev-1.14.0',
      provider: 'lobehub',
      questions: {
        helpful: {
          criteria: { false: 'No.', true: 'Yes.' },
          instructions: 'Helpful?',
          type: 'boolean' as const,
        },
      },
      state: 'x',
    });

    const { metadata } = decide.mock.calls[0][1];
    expect(metadata).toMatchObject({ scenario: 'kept' });
    expect(metadata).not.toHaveProperty('billingAgentId');
    expect(metadata).not.toHaveProperty('agentShare');
  });
});
