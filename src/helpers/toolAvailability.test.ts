import { describe, expect, it } from 'vitest';

import {
  filterToolIdsByCurrentEnv,
  isInstalledPluginAvailableInCurrentEnv,
  isToolAvailableInCurrentEnv,
} from './toolAvailability';

describe('toolAvailability', () => {
  it('should hide desktop-only builtin skills in web', () => {
    expect(
      filterToolIdsByCurrentEnv(['lobe-agent-browser', 'lobe-web-browsing'], { isDesktop: false }),
    ).toEqual(['lobe-web-browsing']);
  });

  it('should hide stdio mcp plugins in web', () => {
    expect(
      filterToolIdsByCurrentEnv(['local-mcp', 'remote-mcp'], {
        installedPlugins: [
          {
            customParams: { mcp: { type: 'stdio' } },
            identifier: 'local-mcp',
          },
        ],
        isDesktop: false,
      }),
    ).toEqual(['remote-mcp']);
  });

  it('should keep deprecated tool ids visible for cleanup', () => {
    expect(filterToolIdsByCurrentEnv(['deleted-plugin'], { isDesktop: false })).toEqual([
      'deleted-plugin',
    ]);
  });

  it('should mark stdio mcp plugins as unavailable in web', () => {
    expect(
      isInstalledPluginAvailableInCurrentEnv(
        { customParams: { mcp: { type: 'stdio' } }, identifier: 'local-mcp' },
        { isDesktop: false },
      ),
    ).toBe(false);
  });

  it('should mark desktop-only builtin tools as unavailable in web when injected', () => {
    expect(
      isToolAvailableInCurrentEnv('lobe-agent-browser', {
        installedPlugins: [],
        isDesktop: false,
      }),
    ).toBe(false);
  });
});
