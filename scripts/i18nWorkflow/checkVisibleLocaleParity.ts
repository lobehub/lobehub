/**
 * Assert key-set parity across Aico visible locales (fa-IR, en-US, fr-FR).
 *
 * Usage:
 *   bun run i18n:parity
 *   bun run i18n:parity -- --namespaces=aico,chat
 *
 * Fails (exit 1) when any visible locale is missing keys that exist in en-US
 * for the same namespace JSON file. Extra keys in a locale are reported as
 * warnings but do not fail the check (upstream locales can temporarily diverge).
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Keep in sync with packages/locales/src/resources.ts VISIBLE_LOCALES */
const VISIBLE_LOCALES = ['fa-IR', 'en-US', 'fr-FR'] as const;
const referenceLocale = 'en-US';

const root = resolve(import.meta.dirname, '../..');
const localesDir = resolve(root, 'locales');

const parseNamespaceFilter = (): Set<string> | null => {
  const arg = process.argv.find((a) => a.startsWith('--namespaces='));
  if (!arg) return null;
  return new Set(
    arg
      .slice('--namespaces='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
};

const listNamespaces = (locale: string): string[] => {
  const dir = resolve(localesDir, locale);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''));
};

const loadKeys = (locale: string, ns: string): Set<string> => {
  const file = resolve(localesDir, locale, `${ns}.json`);
  if (!existsSync(file)) return new Set();
  const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  return new Set(Object.keys(data));
};

const visible = [...VISIBLE_LOCALES];
const filter = parseNamespaceFilter();
const namespaces = listNamespaces(referenceLocale).filter((ns) => !filter || filter.has(ns));

type Gap = { locale: string; ns: string; missing: string[] };
const gaps: Gap[] = [];
const extras: Gap[] = [];

for (const ns of namespaces) {
  const refKeys = loadKeys(referenceLocale, ns);
  for (const locale of visible) {
    if (locale === referenceLocale) continue;
    const keys = loadKeys(locale, ns);
    if (keys.size === 0 && !existsSync(resolve(localesDir, locale, `${ns}.json`))) {
      gaps.push({ locale, missing: [...refKeys].sort(), ns });
      continue;
    }
    const missing = [...refKeys].filter((k) => !keys.has(k)).sort();
    if (missing.length) gaps.push({ locale, missing, ns });
    const extra = [...keys].filter((k) => !refKeys.has(k)).sort();
    if (extra.length) extras.push({ locale, missing: extra, ns });
  }
}

if (extras.length) {
  console.log('⚠ Extra keys vs en-US (non-fatal):');
  for (const item of extras) {
    console.log(`  ${item.locale}/${item.ns}.json (+${item.missing.length})`);
    for (const key of item.missing.slice(0, 10)) console.log(`    + ${key}`);
    if (item.missing.length > 10) console.log(`    … ${item.missing.length - 10} more`);
  }
}

if (gaps.length === 0) {
  console.log(
    `✓ Visible locale key parity OK (${visible.join(', ')}; ${namespaces.length} namespace(s))`,
  );
  process.exit(0);
}

console.error('✗ Visible locale key parity failures (missing vs en-US):');
let totalMissing = 0;
for (const item of gaps) {
  totalMissing += item.missing.length;
  console.error(`  ${item.locale}/${item.ns}.json (−${item.missing.length})`);
  for (const key of item.missing.slice(0, 25)) console.error(`    − ${key}`);
  if (item.missing.length > 25) console.error(`    … ${item.missing.length - 25} more`);
}
console.error(`\nTotal missing keys: ${totalMissing}`);
process.exit(1);
