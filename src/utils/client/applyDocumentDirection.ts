import { isRtlLang } from 'rtl-detect';

export const getDocumentDirection = (lang?: string) => (isRtlLang(lang ?? '') ? 'rtl' : 'ltr');

export const applyDocumentDirection = (lang?: string) => {
  if (typeof document === 'undefined' || !lang) return;

  document.documentElement.dir = getDocumentDirection(lang);
};
