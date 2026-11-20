/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';

import {
  confirmRemoveAgent,
  getOtherCreatorWarning,
  getRemoveAgentAlert,
  getRemoveAgentConfirmState,
} from './index';

const createModalMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createModal: createModalMock,
}));

vi.mock('i18next', () => ({
  t: (key: string, options?: { count?: number; name?: string }) =>
    options?.count !== undefined
      ? `${key}:${options.count}`
      : options?.name !== undefined
        ? `${key}:${options.name}`
        : key,
}));

type Impact = Awaited<ReturnType<typeof agentService.getAgentDeleteImpact>>;

const own = { createdByOther: false, creatorName: null } as const;
const others = (creatorName: string | null) => ({ createdByOther: true, creatorName }) as const;

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

  it('keeps the plain copy when only the caller owns content', () => {
    expect(getRemoveAgentAlert({ foreignTopicCount: 0, hasForeignContent: false })).toBe(
      'confirmRemoveSessionItemAlert',
    );
  });

  it("warns that teammates' topics may go too when the lookup failed", () => {
    expect(getRemoveAgentAlert(null)).toBe('confirmRemoveSessionItemAlertImpactUnknown');
  });
});

describe('getRemoveAgentConfirmState', () => {
  it('keeps Delete disabled while the impact lookup is in flight', () => {
    expect(getRemoveAgentConfirmState(undefined)).toEqual({
      acknowledgeForeignContent: false,
      acknowledgeOtherCreator: false,
      alert: null,
      canConfirm: false,
      otherCreatorWarning: null,
    });
  });

  it("enables Delete with the warning and acknowledges teammates' content once it loaded", () => {
    expect(
      getRemoveAgentConfirmState({ ...own, foreignTopicCount: 3, hasForeignContent: true }),
    ).toEqual({
      acknowledgeForeignContent: true,
      acknowledgeOtherCreator: false,
      alert: 'confirmRemoveSessionItemAlertWithOthersCount:3',
      canConfirm: true,
      otherCreatorWarning: null,
    });
  });

  it('acknowledges nothing when only the caller owns content', () => {
    expect(
      getRemoveAgentConfirmState({ ...own, foreignTopicCount: 0, hasForeignContent: false }),
    ).toEqual({
      acknowledgeForeignContent: false,
      acknowledgeOtherCreator: false,
      alert: 'confirmRemoveSessionItemAlert',
      canConfirm: true,
      otherCreatorWarning: null,
    });
  });

  it('warns about unknown impact without acknowledging anything when the lookup failed', () => {
    expect(getRemoveAgentConfirmState(null)).toEqual({
      acknowledgeForeignContent: false,
      acknowledgeOtherCreator: false,
      alert: 'confirmRemoveSessionItemAlertImpactUnknown',
      canConfirm: true,
      otherCreatorWarning: null,
    });
  });

  it('warns that someone else created the agent and acknowledges both facts for an Admin delete', () => {
    expect(
      getRemoveAgentConfirmState({
        ...others('速冻鱼'),
        foreignTopicCount: 5,
        hasForeignContent: true,
      }),
    ).toEqual({
      acknowledgeForeignContent: true,
      acknowledgeOtherCreator: true,
      alert: 'confirmRemoveSessionItemAlertWithOthersCount:5',
      canConfirm: true,
      otherCreatorWarning: 'confirmRemoveAgentOtherCreator:速冻鱼',
    });
  });
});

describe('getOtherCreatorWarning', () => {
  it('names the creator', () => {
    expect(
      getOtherCreatorWarning({
        ...others('Tsuki'),
        foreignTopicCount: 0,
        hasForeignContent: false,
      }),
    ).toBe('confirmRemoveAgentOtherCreator:Tsuki');
  });

  it('falls back to "another member" when the creator has no name', () => {
    expect(
      getOtherCreatorWarning({ ...others(null), foreignTopicCount: 0, hasForeignContent: false }),
    ).toBe('confirmRemoveAgentOtherCreatorUnknown');
  });

  it("stays silent on the caller's own agent or a failed lookup", () => {
    expect(
      getOtherCreatorWarning({ ...own, foreignTopicCount: 2, hasForeignContent: true }),
    ).toBeNull();
    expect(getOtherCreatorWarning(null)).toBeNull();
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

  it('still opens the dialog when the impact lookup throws synchronously', async () => {
    vi.spyOn(agentService, 'getAgentDeleteImpact').mockImplementation(() => {
      throw new TypeError('not a function');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => confirmRemoveAgent({ agentId: 'agent-1', onConfirm: vi.fn() })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createModalMock).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
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
