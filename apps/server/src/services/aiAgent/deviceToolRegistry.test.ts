import { BrowserManifest } from '@lobechat/builtin-tool-browser';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import { builtinTools } from '@lobechat/builtin-tools';
import { describe, expect, it } from 'vitest';

import {
  buildAllowedBuiltinTools,
  DEVICE_TOOL_IDENTIFIERS,
  isDeviceToolIdentifier,
} from './deviceToolRegistry';

describe('deviceToolRegistry', () => {
  it('pins the device tool set to exactly local-system + remote-device + browser', () => {
    expect([...DEVICE_TOOL_IDENTIFIERS].sort()).toEqual(
      [
        LocalSystemManifest.identifier,
        RemoteDeviceManifest.identifier,
        BrowserManifest.identifier,
      ].sort(),
    );
  });

  it('isDeviceToolIdentifier recognises the device tools', () => {
    expect(isDeviceToolIdentifier(LocalSystemManifest.identifier)).toBe(true);
    expect(isDeviceToolIdentifier(RemoteDeviceManifest.identifier)).toBe(true);
    expect(isDeviceToolIdentifier(BrowserManifest.identifier)).toBe(true);
    expect(isDeviceToolIdentifier('web-browsing')).toBe(false);
    expect(isDeviceToolIdentifier('')).toBe(false);
  });

  describe('buildAllowedBuiltinTools', () => {
    it('returns the full builtin list when canUseDevice=true and disableLocalSystem=false', () => {
      const result = buildAllowedBuiltinTools({
        canUseDevice: true,
        disableLocalSystem: false,
      });
      expect(result.map((t) => t.identifier).sort()).toEqual(
        builtinTools.map((t) => t.identifier).sort(),
      );
    });

    it('strips BOTH device tools when canUseDevice=false (closes B1)', () => {
      const result = buildAllowedBuiltinTools({
        canUseDevice: false,
        disableLocalSystem: false,
      });
      const ids = result.map((t) => t.identifier);
      expect(ids).not.toContain(LocalSystemManifest.identifier);
      expect(ids).not.toContain(RemoteDeviceManifest.identifier);
      // Non-device builtin tools are still present.
      expect(ids.length).toBeGreaterThan(0);
    });

    it('strips only local-system when canUseDevice=true and disableLocalSystem=true', () => {
      const result = buildAllowedBuiltinTools({
        canUseDevice: true,
        disableLocalSystem: true,
      });
      const ids = result.map((t) => t.identifier);
      expect(ids).not.toContain(LocalSystemManifest.identifier);
      expect(ids).toContain(RemoteDeviceManifest.identifier);
    });

    it('strips both when both flags say strip (canUseDevice=false dominates)', () => {
      const result = buildAllowedBuiltinTools({
        canUseDevice: false,
        disableLocalSystem: true,
      });
      const ids = result.map((t) => t.identifier);
      expect(ids).not.toContain(LocalSystemManifest.identifier);
      expect(ids).not.toContain(RemoteDeviceManifest.identifier);
    });

    it('treats omitted disableLocalSystem as false', () => {
      const result = buildAllowedBuiltinTools({ canUseDevice: true });
      const ids = result.map((t) => t.identifier);
      expect(ids).toContain(LocalSystemManifest.identifier);
    });

    it('strips only remote-device when deviceLocked=true — local-system stays for the routed device', () => {
      const result = buildAllowedBuiltinTools({
        canUseDevice: true,
        deviceLocked: true,
      });
      const ids = result.map((t) => t.identifier);
      expect(ids).not.toContain(RemoteDeviceManifest.identifier);
      expect(ids).toContain(LocalSystemManifest.identifier);
    });

    it('keeps remote-device when deviceLocked is omitted', () => {
      const result = buildAllowedBuiltinTools({ canUseDevice: true });
      const ids = result.map((t) => t.identifier);
      expect(ids).toContain(RemoteDeviceManifest.identifier);
    });
  });
});
