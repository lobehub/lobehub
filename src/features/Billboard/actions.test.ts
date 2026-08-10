import type * as LobechatConst from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BILLBOARD_ACTIONS,
  isBillboardAction,
  resolveBillboardAction,
  runBillboardAction,
} from './actions';

const { openChangelogModal, openFeedbackModal, resetOnboarding } = vi.hoisted(() => ({
  openChangelogModal: vi.fn(),
  openFeedbackModal: vi.fn(),
  resetOnboarding: vi.fn(),
}));

vi.mock('@/components/ChangelogModal', () => ({
  default: openChangelogModal,
  openChangelogModal,
}));

vi.mock('@/components/FeedbackModal', () => ({
  default: openFeedbackModal,
  openFeedbackModal,
}));

vi.mock('@/store/user', () => ({
  getUserStoreState: () => ({ resetOnboarding }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isBillboardAction', () => {
  it('should accept every registered action', () => {
    for (const action of BILLBOARD_ACTIONS) {
      expect(isBillboardAction(action)).toBe(true);
    }
  });

  it('should reject unknown strings', () => {
    expect(isBillboardAction('openSettings')).toBe(false);
    expect(isBillboardAction('')).toBe(false);
    expect(isBillboardAction('OPENCHANGELOG')).toBe(false);
  });

  it('should reject non-string values', () => {
    expect(isBillboardAction(null)).toBe(false);
    expect(isBillboardAction(undefined)).toBe(false);
    expect(isBillboardAction(0)).toBe(false);
    expect(isBillboardAction({})).toBe(false);
  });
});

describe('resolveBillboardAction', () => {
  it('should resolve every registered action on web', () => {
    for (const action of BILLBOARD_ACTIONS) {
      expect(resolveBillboardAction(action)).toBe(action);
    }
  });

  it('should return null for unknown values so the CTA falls back to linkUrl', () => {
    expect(resolveBillboardAction('notARealAction')).toBeNull();
    expect(resolveBillboardAction(null)).toBeNull();
    expect(resolveBillboardAction(undefined)).toBeNull();
  });

  it('should not resolve web-only actions on desktop', async () => {
    vi.resetModules();
    vi.doMock('@lobechat/const', async (importOriginal) => ({
      ...((await importOriginal()) as typeof LobechatConst),
      isDesktop: true,
    }));

    try {
      const desktopActions = await import('./actions');
      expect(desktopActions.resolveBillboardAction('resetOnboarding')).toBeNull();
      expect(desktopActions.resolveBillboardAction('openChangelog')).toBe('openChangelog');
    } finally {
      vi.doUnmock('@lobechat/const');
      vi.resetModules();
    }
  });
});

describe('runBillboardAction', () => {
  it('should open the changelog modal for openChangelog', () => {
    runBillboardAction('openChangelog');

    expect(openChangelogModal).toHaveBeenCalledTimes(1);
    expect(openFeedbackModal).not.toHaveBeenCalled();
  });

  it('should open the feedback modal for openFeedback', () => {
    runBillboardAction('openFeedback');

    expect(openFeedbackModal).toHaveBeenCalledTimes(1);
    expect(openChangelogModal).not.toHaveBeenCalled();
  });

  it('should reset onboarding progress for resetOnboarding', async () => {
    await runBillboardAction('resetOnboarding');

    expect(resetOnboarding).toHaveBeenCalledTimes(1);
  });

  it('should have a runnable handler for every registered action', async () => {
    for (const action of BILLBOARD_ACTIONS) {
      await expect(Promise.resolve(runBillboardAction(action))).resolves.not.toThrow();
    }
  });
});
