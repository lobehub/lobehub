import { describe, expect, it } from 'vitest';

import { getAppBundlePath, getSettingsSidebarWidth } from '../settingsPanes';

describe('settingsPanes', () => {
  it('resolves the outermost app bundle from the executable path', () => {
    expect(getAppBundlePath('/Applications/LobeHub.app/Contents/MacOS/LobeHub')).toBe(
      '/Applications/LobeHub.app',
    );
    expect(
      getAppBundlePath(
        '/repo/node_modules/electron/dist/Electron.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper',
      ),
    ).toBe('/repo/node_modules/electron/dist/Electron.app');
    expect(getAppBundlePath('/usr/local/bin/node')).toBeUndefined();
  });

  it('falls back to window centering on unmeasured macOS versions', () => {
    expect(getSettingsSidebarWidth('27.0.1')).toBe(232);
    expect(getSettingsSidebarWidth('15.6')).toBe(0);
  });
});
