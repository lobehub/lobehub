import type {
  GlobalBillboard,
  GlobalBillboardItem,
  GlobalBillboardItemLocaleFields,
  GlobalBillboardLocaleFields,
} from '@/types/serverConfig';

export interface ResolvedBillboardItem {
  description: string;
  linkLabel: string | null;
  title: string;
}

/**
 * Locale candidate priority: full code (zh-CN) → base code (zh) → other codes sharing the same base (zh-HK) → default fields.
 * Only matches keys that exist in i18n to avoid overriding defaults with undefined values.
 */
const pickLocaleEntry = <T>(i18n: Record<string, T> | undefined, locale: string): T | undefined => {
  if (!i18n) return undefined;

  if (i18n[locale]) return i18n[locale];

  const base = locale.split('-')[0];
  if (i18n[base]) return i18n[base];

  const sameBase = Object.keys(i18n).find((key) => key.split('-')[0] === base);
  return sameBase ? i18n[sameBase] : undefined;
};

export const resolveBillboardItem = (
  item: GlobalBillboardItem,
  locale: string,
): ResolvedBillboardItem => {
  const entry = pickLocaleEntry<GlobalBillboardItemLocaleFields>(item.i18n, locale);

  return {
    description: entry?.description ?? item.description,
    linkLabel: entry?.linkLabel ?? item.linkLabel ?? null,
    title: entry?.title ?? item.title,
  };
};

/**
 * Resolve billboard-level fields (currently only title, used for the ? menu display).
 */
export const resolveBillboardTitle = (billboard: GlobalBillboard, locale: string): string => {
  const entry = pickLocaleEntry<GlobalBillboardLocaleFields>(billboard.i18n, locale);
  return entry?.title ?? billboard.title;
};
