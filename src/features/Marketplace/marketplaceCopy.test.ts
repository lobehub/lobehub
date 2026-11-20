import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { NAVIGATION_ROUTES } from '@/config/routes';

const LOCALES_DIR = path.resolve(__dirname, '../../../locales');
const locales = readdirSync(LOCALES_DIR);

const readNs = (locale: string, ns: string): Record<string, string> =>
  JSON.parse(readFileSync(path.resolve(LOCALES_DIR, locale, `${ns}.json`), 'utf8'));

/** Keys that name the Marketplace page or entry (formerly "Community"). */
const PAGE_NAME_KEYS: Record<string, string[]> = {
  common: ['tab.marketplace', 'cmdk.context.community', 'cmdk.keywords.marketplace'],
  electron: [
    'navigation.marketplace',
    'navigation.marketplaceAgents',
    'navigation.marketplaceMcp',
    'navigation.marketplaceModels',
    'navigation.marketplaceProviders',
    'navigation.marketplaceSkills',
  ],
};

/** Keys that only named the page as "Community" / "Discover" and were replaced. */
const RETIRED_KEYS: Record<string, string[]> = {
  common: ['tab.community', 'cmdk.community', 'cmdk.keywords.community'],
  electron: [
    'navigation.discover',
    'navigation.discoverAssistants',
    'navigation.discoverMcp',
    'navigation.discoverModels',
    'navigation.discoverProviders',
  ],
};

describe('Marketplace page copy', () => {
  it('names the command-menu entry like the sidebar and keeps "community" searchable', () => {
    const route = NAVIGATION_ROUTES.find((r) => r.id === 'community')!;

    expect(route.cmdkKey).toBe('tab.marketplace');
    expect(route.electronKey).toBe('navigation.marketplace');
    expect(route.keywordsKey).toBe('cmdk.keywords.marketplace');
    expect(route.keywords).toEqual(expect.arrayContaining(['marketplace', 'community']));

    const enKeywords = readNs('en-US', 'common')['cmdk.keywords.marketplace'].split(' ');
    expect(enKeywords).toEqual(expect.arrayContaining(['marketplace', 'community']));
  });

  it.each(locales)('%s translates every page-name key and drops the retired ones', (locale) => {
    for (const [ns, keys] of Object.entries(PAGE_NAME_KEYS)) {
      const json = readNs(locale, ns);
      for (const key of keys) expect(json[key], `${locale}/${ns}:${key}`).toBeTruthy();
    }
    for (const [ns, keys] of Object.entries(RETIRED_KEYS)) {
      const json = readNs(locale, ns);
      for (const key of keys) expect(json[key], `${locale}/${ns}:${key}`).toBeUndefined();
    }
  });

  it('names the Marketplace as the place an agent is published before social sharing', () => {
    const hint = (locale: string) => readNs(locale, 'chat')['shareModal.social.agent.disabledHint'];

    expect(hint('en-US')).toContain(readNs('en-US', 'common')['tab.marketplace']);
    expect(hint('zh-CN')).toContain(readNs('zh-CN', 'common')['tab.marketplace']);
    for (const locale of locales) {
      const value = hint(locale);
      if (value) expect(value, locale).not.toMatch(/Community|社区|社群/);
    }
  });

  it('translates every Marketplace sidebar entry in zh-CN', () => {
    const zh = readNs('zh-CN', 'discover');
    const navKeys = ['tab.assistant', 'tab.skill', 'tab.connector', 'tab.model', 'tab.provider'];
    for (const key of navKeys) expect(zh[key], `zh-CN/discover:${key}`).toMatch(/\p{Script=Han}/u);
    expect(zh['tab.skill']).toBe(readNs('zh-CN', 'setting')['tab.skill']);
  });

  it('uses the same page name in every locale as the sidebar entry', () => {
    for (const locale of locales) {
      const name = readNs(locale, 'common')['tab.marketplace'];
      expect(readNs(locale, 'electron')['navigation.marketplace'], locale).toBe(name);
      expect(readNs(locale, 'common')['cmdk.context.community'], locale).toBe(name);
    }
  });
});
