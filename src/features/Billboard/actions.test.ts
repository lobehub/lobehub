import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BILLBOARD_ACTIONS, isBillboardAction, runBillboardAction } from './actions';

const { openChangelogModal, openFeedbackModal } = vi.hoisted(() => ({
  openChangelogModal: vi.fn(),
  openFeedbackModal: vi.fn(),
}));

vi.mock('@/components/ChangelogModal', () => ({
  default: openChangelogModal,
  openChangelogModal,
}));

vi.mock('@/components/FeedbackModal', () => ({
  default: openFeedbackModal,
  openFeedbackModal,
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

  it('should have a runnable handler for every registered action', () => {
    for (const action of BILLBOARD_ACTIONS) {
      expect(() => runBillboardAction(action)).not.toThrow();
    }
  });
});
