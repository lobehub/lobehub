import { describe, expect, it } from 'vitest';

import {
  getPrivateDeviceBlock,
  getTargetHint,
  getTargetSelectValue,
} from './heteroTargetSelection';

describe('getPrivateDeviceBlock', () => {
  it('blocks a private device on the shared row of a public workspace agent', () => {
    expect(
      getPrivateDeviceBlock({
        canManageAgent: true,
        isWorkspaceAgent: true,
        visibility: 'public',
      }),
    ).toBe('publicAgent');
  });

  it('blocks a private device once a private agent is fixed', () => {
    expect(
      getPrivateDeviceBlock({
        canManageAgent: true,
        isWorkspaceAgent: true,
        selectionPolicy: 'fixed',
        visibility: 'private',
      }),
    ).toBe('fixed');
  });

  it("allows the owner's private device on a private agent", () => {
    expect(
      getPrivateDeviceBlock({
        canManageAgent: true,
        isWorkspaceAgent: true,
        selectionPolicy: 'member',
        visibility: 'private',
      }),
    ).toBeUndefined();
  });

  it("allows a member's private device, which stays in their own override", () => {
    expect(
      getPrivateDeviceBlock({
        canManageAgent: false,
        isWorkspaceAgent: true,
        visibility: 'public',
      }),
    ).toBeUndefined();
  });

  it('never blocks for a personal agent', () => {
    expect(
      getPrivateDeviceBlock({ canManageAgent: true, isWorkspaceAgent: false }),
    ).toBeUndefined();
  });
});

describe('getTargetSelectValue', () => {
  it('selects the bound device', () => {
    expect(getTargetSelectValue('device', 'device-us-1')).toBe('device:device-us-1');
  });

  it('selects this desktop or the sandbox', () => {
    expect(getTargetSelectValue('local', 'device-us-1')).toBe('target:local');
    expect(getTargetSelectValue('sandbox', undefined)).toBe('target:sandbox');
  });

  it('leaves the placeholder when nothing runnable is chosen', () => {
    expect(getTargetSelectValue('device', undefined)).toBeUndefined();
    expect(getTargetSelectValue('none', undefined)).toBeUndefined();
    expect(getTargetSelectValue('auto', undefined)).toBeUndefined();
  });
});

describe('getTargetHint', () => {
  it('explains a fixed environment before anything else', () => {
    expect(getTargetHint({ isOverridden: true, isSelectable: false })).toBe('fixed');
  });

  it("says when the caller's own pick applies", () => {
    expect(getTargetHint({ isOverridden: true, isSelectable: true })).toBe('overridden');
  });

  it('otherwise describes what the default sets', () => {
    expect(getTargetHint({ isOverridden: false, isSelectable: true })).toBe('default');
  });
});
