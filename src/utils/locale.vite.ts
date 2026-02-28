import { normalizeLocale } from '@/locales/resources';

// Use antd ESM locale (es/locale) - CJS locale (locale/*.js) uses module.exports and breaks in Vite
const antdLocaleLoaders = import.meta.glob(
  '/node_modules/antd/es/locale/{ar_EG,bg_BG,de_DE,en_US,es_ES,fa_IR,fr_FR,it_IT,ja_JP,ko_KR,nl_NL,pl_PL,pt_BR,ru_RU,tr_TR,vi_VN,zh_CN,zh_TW}.js',
);

export const getAntdLocale = async (lang?: string) => {
  let normalLang: any = normalizeLocale(lang);

  // due to antd only have ar-EG locale, we need to convert ar to ar-EG
  // refs: https://ant.design/docs/react/i18n
  if (normalLang === 'ar') normalLang = 'ar-EG';

  const localePath = `/node_modules/antd/es/locale/${normalLang.replace('-', '_')}.js`;
  const loadLocale = antdLocaleLoaders[localePath];

  if (!loadLocale) {
    throw new Error(`Unsupported antd locale: ${normalLang}`);
  }

  const mod = (await loadLocale()) as Record<string, unknown>;
  return mod.default;
};
