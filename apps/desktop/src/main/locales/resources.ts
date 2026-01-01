/**
 * 规范化语言代码
 */
export const normalizeLocale = (locale: string) => {
  return locale.toLowerCase().replace('_', '-');
};

/**
 * 按需加载翻译资源
 */
export const loadResources = async (lng: string, ns: string) => {
  // All en-* locales fallback to 'en' and use default TypeScript files
  if (lng === 'en' || lng.startsWith('en-')) {
    try {
      const { default: content } = await import(`@/locales/default/${ns}.ts`);

      return content;
    } catch (error) {
      console.error(`[I18n] 无法加载翻译文件: ${ns}`, error);
      return {};
    }
  }

  try {
    const { default: content } = await import(`@/../../resources/locales/${lng}/${ns}.json`);

    return content;
  } catch (error) {
    console.error(`无法加载翻译文件: ${lng} - ${ns}`, error);
    return {};
  }
};
