/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';

import { confirmRemoveAgent, getRemoveAgentAlert, getRemoveAgentConfirmState } from './index';

const createModalMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createModal: createModalMock,
}));

vi.mock('i18next', () => ({
  t: (key: string, options?: { count?: number }) =>
    options?.count === undefined ? key : `${key}:${options.count}`,
}));

type Impact = Awaited<ReturnType<typeof agentService.getAgentDeleteImpact>>;

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

describe('getRemoveAgentConfirmState', () => {
  it('keeps Delete disabled while the impact lookup is in flight', () => {
    expect(getRemoveAgentConfirmState(undefined)).toEqual({
      acknowledgeForeignContent: false,
      alert: null,
      canConfirm: false,
    });
  });

  it("enables Delete with the warning and acknowledges teammates' content once it loaded", () => {
    expect(getRemoveAgentConfirmState({ foreignTopicCount: 3, hasForeignContent: true })).toEqual({
      acknowledgeForeignContent: true,
      alert: 'confirmRemoveSessionItemAlertWithOthersCount:3',
      canConfirm: true,
    });
  });

  it('acknowledges nothing when only the caller owns content', () => {
    expect(getRemoveAgentConfirmState({ foreignTopicCount: 0, hasForeignContent: false })).toEqual({
      acknowledgeForeignContent: false,
      alert: 'confirmRemoveSessionItemAlert',
      canConfirm: true,
    });
  });

  it('falls back to the plain copy without acknowledging anything when the lookup failed', () => {
    expect(getRemoveAgentConfirmState(null)).toEqual({
      acknowledgeForeignContent: false,
      alert: 'confirmRemoveSessionItemAlert',
      canConfirm: true,
    });
  });
});

describe('confirmRemoveAgent', () => {
  beforeEach(() => {
    createModalMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the dialog right away, before the impact lookup lands', () => {
    vi.spyOn(agentService, 'getAgentDeleteImpact').mockReturnValue(new Promise<Impact>(() => {}));

    confirmRemoveAgent({ agentId: 'agent-1', onConfirm: vi.fn() });

    expect(createModalMock).toHaveBeenCalledTimes(1);
    expect(createModalMock.mock.calls[0][0]).toMatchObject({ title: 'delete', width: 420 });
    expect(agentService.getAgentDeleteImpact).toHaveBeenCalledWith('agent-1');
  });

  it('does not reject when the impact lookup fails', async () => {
    vi.spyOn(agentService, 'getAgentDeleteImpact').mockRejectedValue(new Error('network'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    confirmRemoveAgent({ agentId: 'agent-1', onConfirm: vi.fn() });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createModalMock).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
  });
});
