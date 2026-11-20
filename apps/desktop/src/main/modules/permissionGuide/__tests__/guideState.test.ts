import { describe, expect, it } from 'vitest';

import type { GuidePhase } from '../guideState';
import { buildGuideState } from '../guideState';

const t = (key: string) => key;
const build = (phase: GuidePhase) =>
  buildGuideState({
    appName: 'LobeHub',
    appPath: '/Applications/LobeHub.app',
    permission: 'accessibility',
    phase,
    sidebarWidth: 232,
    t,
  });

describe('buildGuideState', () => {
  it('only offers the app as a drag source while waiting for a drop', () => {
    const draggable = (
      ['confirming', 'granted', 'missing', 'offPane', 'relaunch', 'retry', 'waiting'] as const
    ).filter((phase) => build(phase).draggable);

    expect(draggable).toEqual(['retry', 'waiting']);
  });

  it('gives every recoverable phase an action', () => {
    expect(build('missing').actionLabel).toBe('permissionGuide.missing.action');
    expect(build('offPane').actionLabel).toBe('permissionGuide.offPane.action');
    expect(build('relaunch').actionLabel).toBe('permissionGuide.relaunch.action');
  });
});
