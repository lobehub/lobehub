import { beforeEach, describe, expect, it } from 'vitest';

import { IoCContainer } from '../IoCContainer';

describe('IoCContainer', () => {
  // Sample class targets for testing WeakMap storage
  class TestController {}
  class AnotherController {}

  beforeEach(() => {
    // Reset static WeakMaps by creating new instances
    // WeakMaps can't be cleared, but we can verify they work correctly
    // For each test, use fresh class instances
  });

  describe('shortcuts WeakMap', () => {
    it('should store shortcut metadata', () => {
      const metadata = [{ methodName: 'toggleDarkMode', name: 'CmdOrCtrl+Shift+D' }];

      IoCContainer.shortcuts.set(TestController, metadata);

      expect(IoCContainer.shortcuts.get(TestController)).toEqual(metadata);
    });

    it('should allow multiple shortcuts per class', () => {
      const metadata = [
        { methodName: 'toggleDarkMode', name: 'CmdOrCtrl+Shift+D' },
        { methodName: 'openSettings', name: 'CmdOrCtrl+,' },
        { methodName: 'newChat', name: 'CmdOrCtrl+N' },
      ];

      IoCContainer.shortcuts.set(TestController, metadata);

      const stored = IoCContainer.shortcuts.get(TestController);
      expect(stored).toHaveLength(3);
    });

    it('should return undefined for unregistered class', () => {
      class UnregisteredClass {}

      expect(IoCContainer.shortcuts.get(UnregisteredClass)).toBeUndefined();
    });
  });

  describe('protocolHandlers WeakMap', () => {
    it('should store protocol handler metadata', () => {
      const metadata = [{ action: 'install', methodName: 'handleInstall', urlType: 'plugin' }];

      IoCContainer.protocolHandlers.set(TestController, metadata);

      expect(IoCContainer.protocolHandlers.get(TestController)).toEqual(metadata);
    });

    it('should support multiple protocol handlers', () => {
      const metadata = [
        { action: 'install', methodName: 'handleInstall', urlType: 'plugin' },
        { action: 'uninstall', methodName: 'handleUninstall', urlType: 'plugin' },
        { action: 'open', methodName: 'handleOpen', urlType: 'chat' },
      ];

      IoCContainer.protocolHandlers.set(TestController, metadata);

      const stored = IoCContainer.protocolHandlers.get(TestController);
      expect(stored).toHaveLength(3);
      expect(stored?.map((h) => h.urlType)).toContain('plugin');
      expect(stored?.map((h) => h.urlType)).toContain('chat');
    });

    it('should allow different classes to have different handlers', () => {
      const metadata1 = [{ action: 'install', methodName: 'handleInstall', urlType: 'plugin' }];
      const metadata2 = [{ action: 'open', methodName: 'handleOpen', urlType: 'chat' }];

      IoCContainer.protocolHandlers.set(TestController, metadata1);
      IoCContainer.protocolHandlers.set(AnotherController, metadata2);

      expect(IoCContainer.protocolHandlers.get(TestController)?.[0].urlType).toBe('plugin');
      expect(IoCContainer.protocolHandlers.get(AnotherController)?.[0].urlType).toBe('chat');
    });
  });

  describe('init', () => {
    it('should be callable without error', () => {
      const container = new IoCContainer();

      expect(() => container.init()).not.toThrow();
    });

    it('should return undefined', () => {
      const container = new IoCContainer();

      const result = container.init();

      expect(result).toBeUndefined();
    });
  });

  describe('static properties', () => {
    it('should have shortcuts as a WeakMap', () => {
      expect(IoCContainer.shortcuts).toBeInstanceOf(WeakMap);
    });

    it('should have protocolHandlers as a WeakMap', () => {
      expect(IoCContainer.protocolHandlers).toBeInstanceOf(WeakMap);
    });
  });
});
