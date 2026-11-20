import { describe, expect, it } from 'vitest';

import auth from '@/locales/default/auth';
import labs from '@/locales/default/labs';
import setting from '@/locales/default/setting';
import subscription from '@/locales/default/subscription';

import { SETTINGS_TAB_TITLE_KEYS } from './tabTitles';

const NAMESPACES: Record<string, Record<string, unknown>> = { auth, labs, setting, subscription };

describe('SETTINGS_TAB_TITLE_KEYS', () => {
  // The route and chunk skeletons render these keys as the header title; a
  // missing key would show the raw key instead of the page's real title.
  it.each(Object.entries(SETTINGS_TAB_TITLE_KEYS))('%s title key exists', (_, entry) => {
    const [ns, key] = entry!;
    expect(NAMESPACES[ns], ns).toBeDefined();
    expect(typeof NAMESPACES[ns][key], `${ns}:${key}`).toBe('string');
  });
});
