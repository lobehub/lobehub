import type * as LobechatConst from '@lobechat/const';
import { OFFICIAL_URL } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BILLBOARD_ACTIONS,
  isBillboardAction,
  resolveBillboardAction,
  runBillboardAction,
} from './actions';

const { openChangelogModal, openFeedbackModal, resetOnboarding, openExternalLink, electronState } =
  vi.hoisted(() => ({
    electronState: {
      dataSyncConfig: { storageMode: 'cloud' } as {
        active?: boolean;
        remoteServerUrl?: string;
        storageMode: 'cloud' | 'selfHost';
      },
    },
    openChangelogModal: vi.fn(),
    openExternalLink: vi.fn(),
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

vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => electronState,
}));

vi.mock('@/services/electron/system', () => ({
  electronSystemService: { openExternalLink },
}));

const importDesktopActions = async () => {
  vi.resetModules();
  vi.doMock('@lobechat/const', async (importOriginal) => ({
    ...((await importOriginal()) as typeof LobechatConst),
    isDesktop: true,
  }));
  return import('./actions');
};

const restoreDesktopMock = () => {
  vi.doUnmock('@lobechat/const');
  vi.resetModules();
};

const originalHref = window.location.href;

beforeEach(() => {
  vi.clearAllMocks();
  electronState.dataSyncConfig = { storageMode: 'cloud' };
  window.location.href = originalHref;
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
  it('should resolve every registered action on official web', () => {
    window.location.href = OFFICIAL_URL;

    for (const action of BILLBOARD_ACTIONS) {
      expect(resolveBillboardAction(action)).toBe(action);
    }
  });

  it('should not resolve resetOnboarding on a self-hosted web origin', () => {
    window.location.href = 'https://chat.example.com/';

    expect(resolveBillboardAction('resetOnboarding')).toBeNull();
    expect(resolveBillboardAction('openChangelog')).toBe('openChangelog');
    expect(resolveBillboardAction('openFeedback')).toBe('openFeedback');
  });

  it('should return null for unknown values so the CTA falls back to linkUrl', () => {
    expect(resolveBillboardAction('notARealAction')).toBeNull();
    expect(resolveBillboardAction(null)).toBeNull();
    expect(resolveBillboardAction(undefined)).toBeNull();
  });

  it('should not resolve resetOnboarding on desktop in local mode', async () => {
    electronState.dataSyncConfig = { active: false, storageMode: 'cloud' };

    try {
      const desktopActions = await importDesktopActions();
      expect(desktopActions.resolveBillboardAction('resetOnboarding')).toBeNull();
      expect(desktopActions.resolveBillboardAction('openChangelog')).toBe('openChangelog');
    } finally {
      restoreDesktopMock();
    }
  });

  it('should not resolve resetOnboarding on desktop synced to a self-host server', async () => {
    electronState.dataSyncConfig = {
      active: true,
      remoteServerUrl: 'https://my-server.example.com',
      storageMode: 'selfHost',
    };

    try {
      const desktopActions = await importDesktopActions();
      expect(desktopActions.resolveBillboardAction('resetOnboarding')).toBeNull();
    } finally {
      restoreDesktopMock();
    }
  });

  it('should resolve resetOnboarding on desktop synced to official cloud', async () => {
    electronState.dataSyncConfig = { active: true, storageMode: 'cloud' };

    try {
      const desktopActions = await importDesktopActions();
      expect(desktopActions.resolveBillboardAction('resetOnboarding')).toBe('resetOnboarding');
    } finally {
      restoreDesktopMock();
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
    expect(openExternalLink).not.toHaveBeenCalled();
  });

  it('should reset then open the official web onboarding externally on desktop', async () => {
    electronState.dataSyncConfig = { active: true, storageMode: 'cloud' };

    try {
      const desktopActions = await importDesktopActions();
      await desktopActions.runBillboardAction('resetOnboarding');

      expect(resetOnboarding).toHaveBeenCalledTimes(1);
      expect(openExternalLink).toHaveBeenCalledWith('https://app.lobehub.com/onboarding');
    } finally {
      restoreDesktopMock();
    }
  });

  it('should have a runnable handler for every registered action', async () => {
    for (const action of BILLBOARD_ACTIONS) {
      await expect(Promise.resolve(runBillboardAction(action))).resolves.not.toThrow();
    }
  });
});
