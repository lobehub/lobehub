import type { GlobalBillboardItem, GlobalBillboardItemLocaleFields } from '@/types/serverConfig';

export interface ResolvedBillboardItem {
  description: string;
  linkLabel: string | null;
  title: string;
}

/**
 * locale 候选优先级：完整 code（zh-CN） → 基础 code（zh） → 其它共享同基础的 code（zh-HK）→ 默认字段。
 * 只命中 item.i18n 中存在的 key，避免把 undefined 当作有效值覆盖默认。
 */
const pickLocaleEntry = (
  i18n: Record<string, GlobalBillboardItemLocaleFields> | undefined,
  locale: string,
): GlobalBillboardItemLocaleFields | undefined => {
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
  const entry = pickLocaleEntry(item.i18n, locale);

  return {
    description: entry?.description ?? item.description,
    linkLabel: entry?.linkLabel ?? item.linkLabel ?? null,
    title: entry?.title ?? item.title,
  };
};
