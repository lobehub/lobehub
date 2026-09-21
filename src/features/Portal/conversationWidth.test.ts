import { describe, expect, it } from 'vitest';

import { PortalViewType } from '@/store/chat/slices/portal/initialState';

import {
  getPortalViewMaxWidth,
  getPortalViewMinWidth,
  getPortalViewWidth,
  portalWidthStorageKey,
} from './portalWidth';

/**
 * The goal page hosts a plain conversation in the panel when no drill-down
 * view is open (`viewType === null`). Before it had its own storage key it
 * shared `home` with the work views and inherited the 1280 work-surface drag
 * ceiling, so the conversation could be (and persist as) unreadably wide.
 * These tests pin the conversation's independent width identity.
 */
describe('side conversation width identity', () => {
  it('gives the conversation its own storage key, separate from home', () => {
    const widths = { 'goal:conversation': 500, 'goal:home': 900 };

    expect(getPortalViewWidth({ scope: 'goal', viewType: null, widths })).toBe(500);
  });

  it('stores the conversation under its own key', () => {
    expect(portalWidthStorageKey(null, 'goal')).toBe('goal:conversation');
    expect(portalWidthStorageKey(undefined, 'goal')).toBe('goal:conversation');
    expect(portalWidthStorageKey(PortalViewType.Home, 'goal')).toBe('goal:home');
    expect(portalWidthStorageKey(null)).toBe('conversation');
  });

  it('caps the conversation drag ceiling at the conversation width', () => {
    expect(getPortalViewMaxWidth(null)).toBe(560);
    expect(getPortalViewMaxWidth(undefined)).toBe(560);
    // Home is the panel's "no drill-down" host state too (the Workspace view
    // is never pushed by any live UI), so it shares the conversation bounds.
    expect(getPortalViewMaxWidth(PortalViewType.Home)).toBe(560);
    expect(getPortalViewMaxWidth(PortalViewType.TaskDetail)).toBe(1280);
    expect(getPortalViewMaxWidth(PortalViewType.ToolUI)).toBe(1280);
  });

  it('clamps a previously over-wide conversation memory back into bounds', () => {
    // A user who dragged the old unbounded conversation wide keeps a usable
    // column instead of a work-surface-width chat; a too-narrow memory
    // clamps back up to the reading width.
    expect(
      getPortalViewWidth({ scope: 'goal', viewType: null, widths: { 'goal:conversation': 930 } }),
    ).toBe(560);
    expect(
      getPortalViewWidth({ scope: 'goal', viewType: null, widths: { 'goal:conversation': 200 } }),
    ).toBe(400);
  });

  it('ignores the legacy shared width even when no conversation memory exists', () => {
    expect(
      getPortalViewWidth({ legacyWidth: 700, scope: 'goal', viewType: null, widths: {} }),
    ).toBe(400);
    expect(getPortalViewWidth({ legacyWidth: 480, viewType: null })).toBe(400);
  });

  it('keeps work-view fallbacks untouched by the conversation bounds', () => {
    expect(getPortalViewWidth({ legacyWidth: 480, viewType: PortalViewType.Document })).toBe(480);
    expect(getPortalViewMinWidth(PortalViewType.Document)).toBe(400);
    expect(getPortalViewMinWidth(null)).toBe(400);
  });
});
