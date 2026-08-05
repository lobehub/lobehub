import { describe, expect, it } from 'vitest';

import { CHAT_PORTAL_WIDE_WIDTH, CHAT_PORTAL_WIDTH } from '@/const/layoutTokens';

import { fitsBesidePortal } from './fitsBesidePortal';

const SIDEBAR = 360;

describe('fitsBesidePortal', () => {
  it('keeps the sidebar until the row has been measured', () => {
    expect(fitsBesidePortal({ portalWidth: CHAT_PORTAL_WIDE_WIDTH, sidebarWidth: SIDEBAR })).toBe(
      true,
    );
    expect(
      fitsBesidePortal({
        availableWidth: 0,
        portalWidth: CHAT_PORTAL_WIDE_WIDTH,
        sidebarWidth: SIDEBAR,
      }),
    ).toBe(true);
  });

  it('yields the sidebar when a wide portal would squeeze the conversation out', () => {
    // the reported regression: 1200px window, acceptance portal at 840
    expect(
      fitsBesidePortal({
        availableWidth: 1182,
        portalWidth: CHAT_PORTAL_WIDE_WIDTH,
        sidebarWidth: SIDEBAR,
      }),
    ).toBe(false);
  });

  it('keeps all three when the row is wide enough', () => {
    expect(
      fitsBesidePortal({
        availableWidth: 1710,
        portalWidth: CHAT_PORTAL_WIDE_WIDTH,
        sidebarWidth: SIDEBAR,
      }),
    ).toBe(true);
  });

  it('leaves the sidebar alone while the portal is closed', () => {
    expect(fitsBesidePortal({ availableWidth: 1182, portalWidth: 0, sidebarWidth: SIDEBAR })).toBe(
      true,
    );
  });

  it('still fits a narrow portal at the same row width that a wide one does not', () => {
    expect(
      fitsBesidePortal({
        availableWidth: 1182,
        portalWidth: CHAT_PORTAL_WIDTH,
        sidebarWidth: SIDEBAR,
      }),
    ).toBe(true);
  });
});
