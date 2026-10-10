import type { ServerNamespace, ServerTranslator, TranslationParams } from './types';

export type ServerResources = Record<
  string,
  Partial<Record<ServerNamespace, Record<string, string>>>
>;

export const createServerTranslator = <N extends ServerNamespace>(
  resources: ServerResources,
  ns: N,
  locale: string,
  defaultLocale: string,
): ServerTranslator<N> => {
  const find = (key: string, options: TranslationParams = {}) => {
    const lookup = (language: string) => {
      const catalog = resources[language]?.[ns];
      return catalog && Object.hasOwn(catalog, key) ? catalog[key] : undefined;
    };
    const value = lookup(locale) || lookup(defaultLocale);
    if (!value) return undefined;
    return value.replaceAll(/\{\{([^{}]+)\}\}/g, (placeholder, name: string) =>
      Object.hasOwn(options, name) ? options[name] : placeholder,
    );
  };
  return { find, locale, t: (key, options) => find(key, options) ?? key };
};
