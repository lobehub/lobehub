import { describe, expect, it } from 'vitest';

import {
  CHAT_PORTAL_MAX_WIDTH,
  CHAT_PORTAL_TOOL_UI_WIDTH,
  CHAT_PORTAL_WIDE_WIDTH,
  CHAT_PORTAL_WIDTH,
} from '@/const/layoutTokens';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';

import { getPortalViewMinWidth, getPortalViewWidth } from './portalWidth';

describe('getPortalViewMinWidth', () => {
  it('keeps the reading column for plain views', () => {
    expect(getPortalViewMinWidth(PortalViewType.Home)).toBe(CHAT_PORTAL_WIDTH);
    expect(getPortalViewMinWidth(null)).toBe(CHAT_PORTAL_WIDTH);
    expect(getPortalViewMinWidth(PortalViewType.Document)).toBe(CHAT_PORTAL_WIDTH);
  });

  it('widens the views that render tool UI, code or nested conversations', () => {
    for (const viewType of [
      PortalViewType.Acceptance,
      PortalViewType.AcceptanceCheck,
      PortalViewType.AgentDetail,
      PortalViewType.Artifact,
      PortalViewType.TaskDetail,
      PortalViewType.Thread,
      PortalViewType.ToolUI,
    ]) {
      expect(getPortalViewMinWidth(viewType)).toBe(CHAT_PORTAL_TOOL_UI_WIDTH);
    }
  });
});

describe('getPortalViewWidth', () => {
  it('opens acceptance wide even when the legacy shared width is narrow', () => {
    expect(
      getPortalViewWidth({ legacyWidth: CHAT_PORTAL_WIDTH, viewType: PortalViewType.Acceptance }),
    ).toBe(CHAT_PORTAL_WIDE_WIDTH);
  });

  it('remembers the width per view instead of sharing one value', () => {
    const widths = { [PortalViewType.Acceptance]: 1000, [PortalViewType.TaskDetail]: 620 };

    expect(getPortalViewWidth({ viewType: PortalViewType.Acceptance, widths })).toBe(1000);
    expect(getPortalViewWidth({ viewType: PortalViewType.TaskDetail, widths })).toBe(620);
    // untouched views are unaffected by the two above
    expect(
      getPortalViewWidth({ legacyWidth: 480, viewType: PortalViewType.Document, widths }),
    ).toBe(480);
  });

  it('falls back to the legacy width for views without an explicit default', () => {
    expect(getPortalViewWidth({ legacyWidth: 520, viewType: PortalViewType.Home })).toBe(520);
    expect(getPortalViewWidth({ viewType: PortalViewType.Home })).toBe(CHAT_PORTAL_WIDTH);
    expect(getPortalViewWidth({})).toBe(CHAT_PORTAL_WIDTH);
  });

  it('clamps to the view min width and the panel max width', () => {
    expect(
      getPortalViewWidth({ legacyWidth: CHAT_PORTAL_WIDTH, viewType: PortalViewType.ToolUI }),
    ).toBe(CHAT_PORTAL_TOOL_UI_WIDTH);
    expect(
      getPortalViewWidth({
        viewType: PortalViewType.Acceptance,
        widths: { [PortalViewType.Acceptance]: 300 },
      }),
    ).toBe(CHAT_PORTAL_TOOL_UI_WIDTH);
    expect(
      getPortalViewWidth({
        viewType: PortalViewType.Acceptance,
        widths: { [PortalViewType.Acceptance]: 9999 },
      }),
    ).toBe(CHAT_PORTAL_MAX_WIDTH);
  });
});
