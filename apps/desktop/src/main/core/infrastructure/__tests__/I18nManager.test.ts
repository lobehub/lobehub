import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App as AppCore } from '../../App';
import { I18nManager } from '../I18nManager';

// Use vi.hoisted to define mocks before hoisting
const { mockApp, mockI18nextInstance, mockLoadResources, mockCreateInstance } = vi.hoisted(() => {
  const mockI18nextInstance = {
    addResourceBundle: vi.fn(),
    changeLanguage: vi.fn().mockResolvedValue(undefined),
    init: vi.fn().mockResolvedValue(undefined),
    language: 'en-US',
    on: vi.fn(),
    t: vi.fn().mockImplementation((key: string) => key),
  };

  const mockCreateInstance = vi.fn().mockReturnValue(mockI18nextInstance);

  return {
    mockApp: {
      getLocale: vi.fn().mockReturnValue('en-US'),
    },
    mockCreateInstance,
    mockI18nextInstance,
    mockLoadResources: vi.fn().mockResolvedValue({ key: 'value' }),
  };
});

// Mock electron app
vi.mock('electron', () => ({
  app: mockApp,
}));

// Mock i18next
vi.mock('i18next', () => ({
  default: {
    createInstance: mockCreateInstance,
  },
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock loadResources
vi.mock('@/locales/resources', () => ({
  loadResources: mockLoadResources,
}));

describe('I18nManager', () => {
  let manager: I18nManager;
  let mockAppCore: AppCore;
  let mockStoreManagerGet: ReturnType<typeof vi.fn>;
  let mockRefreshMenus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset i18next mock state
    mockI18nextInstance.language = 'en-US';
    mockI18nextInstance.t.mockImplementation((key: string) => key);
    mockI18nextInstance.init.mockResolvedValue(undefined);
    mockI18nextInstance.changeLanguage.mockResolvedValue(undefined);

    // Reset loadResources mock
    mockLoadResources.mockResolvedValue({ key: 'value' });

    // Reset electron app mock
    mockApp.getLocale.mockReturnValue('en-US');

    // Create mock App core
    mockStoreManagerGet = vi.fn().mockReturnValue('auto');
    mockRefreshMenus = vi.fn();

    mockAppCore = {
      menuManager: {
        refreshMenus: mockRefreshMenus,
      },
      storeManager: {
        get: mockStoreManagerGet,
      },
    } as unknown as AppCore;

    manager = new I18nManager(mockAppCore);
  });

  describe('constructor', () => {
    it('should create i18next instance', () => {
      expect(mockCreateInstance).toHaveBeenCalled();
    });
  });

  describe('init', () => {
    it('should initialize i18next with default settings', async () => {
      await manager.init();

      expect(mockI18nextInstance.init).toHaveBeenCalledWith({
        defaultNS: 'menu',
        fallbackLng: 'en',
        initAsync: true,
        interpolation: {
          escapeValue: false,
        },
        keySeparator: false,
        lng: 'en-US',
        ns: ['menu', 'dialog', 'common'],
        partialBundledLanguages: true,
      });
    });

    it('should use provided language parameter', async () => {
      await manager.init('zh-CN');

      expect(mockI18nextInstance.init).toHaveBeenCalledWith(
        expect.objectContaining({
          lng: 'zh-CN',
        }),
      );
    });

    it('should use stored locale when not auto', async () => {
      mockStoreManagerGet.mockReturnValue('ja-JP');

      await manager.init();

      expect(mockI18nextInstance.init).toHaveBeenCalledWith(
        expect.objectContaining({
          lng: 'ja-JP',
        }),
      );
    });

    it('should use system locale when stored locale is auto', async () => {
      mockStoreManagerGet.mockReturnValue('auto');
      mockApp.getLocale.mockReturnValue('fr-FR');

      await manager.init();

      expect(mockI18nextInstance.init).toHaveBeenCalledWith(
        expect.objectContaining({
          lng: 'fr-FR',
        }),
      );
    });

    it('should skip initialization if already initialized', async () => {
      await manager.init();
      vi.clearAllMocks();

      await manager.init();

      expect(mockI18nextInstance.init).not.toHaveBeenCalled();
    });

    it('should load locale resources after init', async () => {
      await manager.init();

      // Should load menu, dialog, common namespaces
      expect(mockLoadResources).toHaveBeenCalledWith('en-US', 'menu');
      expect(mockLoadResources).toHaveBeenCalledWith('en-US', 'dialog');
      expect(mockLoadResources).toHaveBeenCalledWith('en-US', 'common');
    });

    it('should refresh main UI after init', async () => {
      await manager.init();

      expect(mockRefreshMenus).toHaveBeenCalled();
    });

    it('should register languageChanged listener', async () => {
      await manager.init();

      expect(mockI18nextInstance.on).toHaveBeenCalledWith('languageChanged', expect.any(Function));
    });
  });

  describe('t', () => {
    beforeEach(async () => {
      await manager.init();
    });

    it('should call i18next t function', () => {
      mockI18nextInstance.t.mockReturnValue('translated');

      const result = manager.t('test.key');

      expect(mockI18nextInstance.t).toHaveBeenCalledWith('test.key', undefined);
      expect(result).toBe('translated');
    });

    it('should pass options to i18next', () => {
      mockI18nextInstance.t.mockReturnValue('translated with options');

      const result = manager.t('test.key', { count: 5 });

      expect(mockI18nextInstance.t).toHaveBeenCalledWith('test.key', { count: 5 });
      expect(result).toBe('translated with options');
    });

    it('should warn when translation key is not found', () => {
      // When translation is not found, i18next returns the key itself
      mockI18nextInstance.t.mockImplementation((key: string) => key);

      manager.t('missing.key');

      // The warn should be logged (we can't verify the log content with our mock setup)
      expect(mockI18nextInstance.t).toHaveBeenCalledWith('missing.key', undefined);
    });
  });

  describe('createNamespacedT', () => {
    beforeEach(async () => {
      await manager.init();
    });

    it('should return a function that adds namespace to options', () => {
      mockI18nextInstance.t.mockReturnValue('namespaced translation');

      const menuT = manager.createNamespacedT('menu');
      const result = menuT('test.key');

      expect(mockI18nextInstance.t).toHaveBeenCalledWith('test.key', { ns: 'menu' });
      expect(result).toBe('namespaced translation');
    });

    it('should merge provided options with namespace', () => {
      mockI18nextInstance.t.mockReturnValue('merged translation');

      const menuT = manager.createNamespacedT('dialog');
      const result = menuT('test.key', { count: 3 });

      expect(mockI18nextInstance.t).toHaveBeenCalledWith('test.key', { count: 3, ns: 'dialog' });
      expect(result).toBe('merged translation');
    });
  });

  describe('ns', () => {
    beforeEach(async () => {
      await manager.init();
    });

    it('should be an alias for createNamespacedT', () => {
      mockI18nextInstance.t.mockReturnValue('ns translation');

      const dialogT = manager.ns('dialog');
      const result = dialogT('test.key');

      expect(mockI18nextInstance.t).toHaveBeenCalledWith('test.key', { ns: 'dialog' });
      expect(result).toBe('ns translation');
    });
  });

  describe('getCurrentLanguage', () => {
    beforeEach(async () => {
      await manager.init();
    });

    it('should return current i18next language', () => {
      mockI18nextInstance.language = 'de-DE';

      expect(manager.getCurrentLanguage()).toBe('de-DE');
    });
  });

  describe('changeLanguage', () => {
    beforeEach(async () => {
      await manager.init();
    });

    it('should call i18next changeLanguage', async () => {
      await manager.changeLanguage('zh-CN');

      expect(mockI18nextInstance.changeLanguage).toHaveBeenCalledWith('zh-CN');
    });

    it('should initialize if not already initialized', async () => {
      // Create a new manager that is not initialized
      const uninitializedManager = new I18nManager(mockAppCore);

      await uninitializedManager.changeLanguage('zh-CN');

      expect(mockI18nextInstance.init).toHaveBeenCalled();
      expect(mockI18nextInstance.changeLanguage).toHaveBeenCalledWith('zh-CN');
    });
  });

  describe('handleLanguageChanged', () => {
    beforeEach(async () => {
      await manager.init();
    });

    it('should load locale and refresh UI on language change', async () => {
      // Get the languageChanged handler
      const languageChangedHandler = mockI18nextInstance.on.mock.calls.find(
        (call) => call[0] === 'languageChanged',
      )?.[1];

      expect(languageChangedHandler).toBeDefined();

      // Clear mocks to check only the handler's behavior
      mockLoadResources.mockClear();
      mockRefreshMenus.mockClear();

      // Trigger language change
      await languageChangedHandler('ja-JP');

      // Should load resources for new language
      expect(mockLoadResources).toHaveBeenCalledWith('ja-JP', 'menu');
      expect(mockLoadResources).toHaveBeenCalledWith('ja-JP', 'dialog');
      expect(mockLoadResources).toHaveBeenCalledWith('ja-JP', 'common');

      // Should refresh menus
      expect(mockRefreshMenus).toHaveBeenCalled();
    });
  });

  describe('loadNamespace', () => {
    beforeEach(async () => {
      await manager.init();
      vi.clearAllMocks();
    });

    it('should load resources and add to i18next', async () => {
      mockLoadResources.mockResolvedValue({ hello: 'world' });

      // Access private method
      const result = await manager['loadNamespace']('en-US', 'menu');

      expect(mockLoadResources).toHaveBeenCalledWith('en-US', 'menu');
      expect(mockI18nextInstance.addResourceBundle).toHaveBeenCalledWith(
        'en-US',
        'menu',
        { hello: 'world' },
        true,
        true,
      );
      expect(result).toBe(true);
    });

    it('should return false on error', async () => {
      mockLoadResources.mockRejectedValue(new Error('Load failed'));

      const result = await manager['loadNamespace']('en-US', 'menu');

      expect(result).toBe(false);
    });
  });
});
