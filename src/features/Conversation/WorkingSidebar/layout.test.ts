import { describe, expect, it } from 'vitest';

import { MIN_PANEL_WIDTH, resolveWorkingPanelPlaceholder } from './layout';

describe('resolveWorkingPanelPlaceholder', () => {
  it('reserves only the overview card when the working panel is closed', () => {
    expect(
      resolveWorkingPanelPlaceholder({ showWorkingOverview: true, workingSidebarWidth: 360 }),
    ).toEqual({ overview: true, rightPanelWidth: undefined });
  });

  it('reserves the stored panel width when the working panel is open', () => {
    expect(
      resolveWorkingPanelPlaceholder({
        showRightPanel: true,
        showWorkingOverview: false,
        workingSidebarWidth: 480,
      }),
    ).toEqual({ overview: false, rightPanelWidth: 480 });
  });

  it('clamps a stored width below the panel minimum', () => {
    expect(
      resolveWorkingPanelPlaceholder({
        showRightPanel: true,
        showWorkingOverview: true,
        workingSidebarWidth: 100,
      }),
    ).toEqual({ overview: true, rightPanelWidth: MIN_PANEL_WIDTH });
  });
});
