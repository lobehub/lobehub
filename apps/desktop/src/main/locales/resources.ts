/**
 * Normalize language code
 */
export const normalizeLocale = (locale: string) => {
  return locale.toLowerCase().replace('_', '-');
};

/**
 * Load translation resources on demand
 */
export const loadResources = async (lng: string, ns: string) => {
  // All en-* locales fallback to 'en' and use default TypeScript files
  if (lng === 'en' || lng.startsWith('en-')) {
    try {
      const { default: content } = await import(`@/locales/default/${ns}.ts`);

      return content;
    } catch (error) {
      console.error(`[I18n] Unable to load translation file: ${ns}`, error);
      return {};
    }
  }

  try {
    const { default: content } = await import(`@/../../resources/locales/${lng}/${ns}.json`);

    return content;
  } catch (error) {
    console.error(`Unable to load translation file: ${lng} - ${ns}`, error);
    return {};
  }
};
