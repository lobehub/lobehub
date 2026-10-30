/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';

import { confirmRemoveAgent } from './index';

const confirmModalMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: confirmModalMock,
}));

vi.mock('i18next', () => ({
  t: (key: string, options?: { count?: number }) =>
    options?.count === undefined ? key : `${key}:${options.count}`,
}));

describe('confirmRemoveAgent', () => {
  beforeEach(() => {
    confirmModalMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns with the count of other members' topics that go with the agent", async () => {
    vi.spyOn(agentService, 'getAgentDeleteImpact').mockResolvedValue({
      foreignTopicCount: 3,
      hasForeignContent: true,
    });
    const onConfirm = vi.fn();

    await confirmRemoveAgent({ agentId: 'agent-1', onConfirm });

    const config = confirmModalMock.mock.calls[0][0];
    expect(config.content).toBe('confirmRemoveSessionItemAlertWithOthersCount:3');
    expect(config.okButtonProps).toEqual({ danger: true });

    await config.onOk();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('falls back to the generic other-members warning when no foreign topic is counted', async () => {
    vi.spyOn(agentService, 'getAgentDeleteImpact').mockResolvedValue({
      foreignTopicCount: 0,
      hasForeignContent: true,
    });

    await confirmRemoveAgent({ agentId: 'agent-1', onConfirm: vi.fn() });

    expect(confirmModalMock.mock.calls[0][0].content).toBe(
      'confirmRemoveSessionItemAlertWithOthers',
    );
  });

  it('keeps the plain copy when only the caller owns content', async () => {
    vi.spyOn(agentService, 'getAgentDeleteImpact').mockResolvedValue({
      foreignTopicCount: 0,
      hasForeignContent: false,
    });

    await confirmRemoveAgent({ agentId: 'agent-1', onConfirm: vi.fn() });

    expect(confirmModalMock.mock.calls[0][0].content).toBe('confirmRemoveSessionItemAlert');
  });

  it('still opens the dialog with the plain copy when the impact lookup fails', async () => {
    vi.spyOn(agentService, 'getAgentDeleteImpact').mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await confirmRemoveAgent({ agentId: 'agent-1', onConfirm: vi.fn() });

    expect(confirmModalMock.mock.calls[0][0].content).toBe('confirmRemoveSessionItemAlert');
  });
});
