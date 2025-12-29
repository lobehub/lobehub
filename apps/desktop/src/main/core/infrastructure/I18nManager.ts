import { app } from 'electron';
import i18next from 'i18next';

import { App } from '@/core/App';
import { loadResources } from '@/locales/resources';
import { createLogger } from '@/utils/logger';

// Create logger
const logger = createLogger('core:I18nManager');

export class I18nManager {
  private i18n: typeof i18next;
  private initialized: boolean = false;
  private app: App;

  constructor(app: App) {
    logger.debug('Initializing I18nManager');
    this.app = app;
    this.i18n = i18next.createInstance();
  }

  /**
   * Initialize i18next instance
   */
  async init(lang?: string) {
    if (this.initialized) {
      logger.debug('I18nManager already initialized, skipping');
      return this.i18n;
    }

    // Priority: parameter language > stored locale > system language
    const storedLocale = this.app.storeManager.get('locale', 'auto') as string;
    const defaultLanguage =
      lang || (storedLocale !== 'auto' ? storedLocale : app.getLocale()) || 'en';

    logger.info(
      `Initializing i18n, app locale: ${defaultLanguage}, stored locale: ${storedLocale}`,
    );

    await this.i18n.init({
      defaultNS: 'menu',
      fallbackLng: 'en',
      // Load resources as needed
      initAsync: true,
      interpolation: {
        escapeValue: false,
      },

      keySeparator: false,
      lng: defaultLanguage,
      ns: ['menu', 'dialog', 'common'],
      partialBundledLanguages: true,
    });

    logger.info(`i18n initialized, language: ${this.i18n.language}`);

    // Preload base namespaces
    await this.loadLocale(this.i18n.language);

    this.initialized = true;

    this.refreshMainUI();

    // Listen for language change events
    this.i18n.on('languageChanged', this.handleLanguageChanged);

    return this.i18n;
  }

  /**
   * Basic translation function
   */
  t = (key: string, options?: any) => {
    const result = this.i18n.t(key, options) as string;

    // If translation result is the same as key, translation might be missing
    if (result === key) {
      logger.warn(`${this.i18n.language} key: ${key} is not found`);
    }

    return result;
  };

  /**
   * Create a translation function bound to a specific namespace
   * @param namespace Namespace
   * @returns Translation function bound to namespace
   */
  createNamespacedT(namespace: string) {
    return (key: string, options: any = {}) => {
      // Copy options to avoid modifying the original object
      const mergedOptions = { ...options };
      // Set namespace
      mergedOptions.ns = namespace;

      return this.t(key, mergedOptions);
    };
  }

  /**
   * Get translation function by namespace
   * Provides a more convenient calling method
   */
  ns = (namespace: string) => this.createNamespacedT(namespace);

  /**
   * Get current language
   */
  getCurrentLanguage() {
    return this.i18n.language;
  }

  /**
   * Change application language
   * @param lng Target language
   */
  public async changeLanguage(lng: string): Promise<void> {
    logger.info(`Changing language to: ${lng}`);

    if (!this.initialized) {
      await this.init();
    }

    await this.i18n.changeLanguage(lng);
    // Language change event will trigger handleLanguageChanged
  }

  /**
   * Handle language change event
   */
  private handleLanguageChanged = async (lang: string) => {
    logger.info(`Language changed to: ${lang}`);
    await this.loadLocale(lang);

    // Notify other parts of main process to refresh UI
    this.refreshMainUI();
  };

  /**
   * Refresh main process UI (menus, etc.)
   */
  private refreshMainUI() {
    logger.debug('Refreshing main UI after language change');
    this.app.menuManager.refreshMenus();
  }

  /**
   * Notify renderer process that language has changed
   */
  private notifyRendererProcess(lng: string) {
    logger.debug(`Notifying renderer process of language change: ${lng}`);

    // Send language change event to all windows
    // const windows = this.app.browserManager.windows;
    //
    // if (windows && windows.length > 0) {
    //   windows.forEach((window) => {
    //     if (window?.webContents) {
    //       window.webContents.send('language-changed', lng);
    //     }
    //   });
    // }
  }

  private async loadLocale(language: string) {
    logger.debug(`Loading locale for language: ${language}`);
    // Preload base namespaces
    await Promise.all(['menu', 'dialog', 'common'].map((ns) => this.loadNamespace(language, ns)));
  }

  /**
   * Load translation resources for specific namespace
   */
  private async loadNamespace(lng: string, ns: string) {
    try {
      logger.debug(`Loading namespace: ${lng}/${ns}`);
      const resources = await loadResources(lng, ns);

      this.i18n.addResourceBundle(lng, ns, resources, true, true);
      return true;
    } catch (error) {
      logger.error(`Failed to load namespace: ${lng}/${ns}`, error);
      return false;
    }
  }
}
