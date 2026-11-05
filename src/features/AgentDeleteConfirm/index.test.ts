/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';

import { confirmRemoveAgent, getRemoveAgentAlert } from './index';

const confirmModalMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: confirmModalMock,
}));

vi.mock('i18next', () => ({
  t: (key: string, options?: { count?: number }) =>
    options?.count === undefined ? key : `${key}:${options.count}`,
}));

type Impact = Awaited<ReturnType<typeof agentService.getAgentDeleteImpact>>;

/** Let the impact lookup's promise chain settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const openDialog = () => {
  const onConfirm = vi.fn();
  confirmRemoveAgent({ agentId: 'agent-1', onConfirm });
  return { config: confirmModalMock.mock.calls[0][0], onConfirm };
};

describe('getRemoveAgentAlert', () => {
  it("warns with the count of other members' topics", () => {
    expect(getRemoveAgentAlert({ foreignTopicCount: 3, hasForeignContent: true })).toBe(
      'confirmRemoveSessionItemAlertWithOthersCount:3',
    );
  });

  it('falls back to the generic other-members warning when no foreign topic is counted', () => {
    expect(getRemoveAgentAlert({ foreignTopicCount: 0, hasForeignContent: true })).toBe(
      'confirmRemoveSessionItemAlertWithOthers',
    );
  });

  it('keeps the plain copy when only the caller owns content or the lookup failed', () => {
    expect(getRemoveAgentAlert({ foreignTopicCount: 0, hasForeignContent: false })).toBe(
      'confirmRemoveSessionItemAlert',
    );
    expect(getRemoveAgentAlert(null)).toBe('confirmRemoveSessionItemAlert');
  });
});

describe('confirmRemoveAgent', () => {
  beforeEach(() => {
    confirmModalMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the danger dialog right away, before the impact lookup lands', () => {
    vi.spyOn(agentService, 'getAgentDeleteImpact').mockReturnValue(new Promise<Impact>(() => {}));

    const { config } = openDialog();

    expect(confirmModalMock).toHaveBeenCalledTimes(1);
    expect(agentService.getAgentDeleteImpact).toHaveBeenCalledWith('agent-1');
    expect(config.okButtonProps).toEqual({ danger: true });
  });

  it('does not acknowledge foreign content when confirmed before the lookup lands', async () => {
    let resolveImpact!: (impact: Impact) => void;
    vi.spyOn(agentService, 'getAgentDeleteImpact').mockReturnValue(
      new Promise<Impact>((resolve) => {
        resolveImpact = resolve;
      }),
    );
    const { config, onConfirm } = openDialog();

    await config.onOk();
    expect(onConfirm).toHaveBeenCalledWith({ acknowledgeForeignContent: false });

    resolveImpact({ foreignTopicCount: 2, hasForeignContent: true });
  });

  it("acknowledges teammates' content once the warning has loaded", async () => {
    vi.spyOn(agentService, 'getAgentDeleteImpact').mockResolvedValue({
      foreignTopicCount: 3,
      hasForeignContent: true,
    });
    const { config, onConfirm } = openDialog();
    await flush();

    await config.onOk();
    expect(onConfirm).toHaveBeenCalledWith({ acknowledgeForeignContent: true });
  });

  it('acknowledges nothing when only the caller owns content', async () => {
    vi.spyOn(agentService, 'getAgentDeleteImpact').mockResolvedValue({
      foreignTopicCount: 0,
      hasForeignContent: false,
    });
    const { config, onConfirm } = openDialog();
    await flush();

    await config.onOk();
    expect(onConfirm).toHaveBeenCalledWith({ acknowledgeForeignContent: false });
  });

  it('acknowledges nothing when the impact lookup fails', async () => {
    vi.spyOn(agentService, 'getAgentDeleteImpact').mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { config, onConfirm } = openDialog();
    await flush();

    await config.onOk();
    expect(onConfirm).toHaveBeenCalledWith({ acknowledgeForeignContent: false });
  });
});
