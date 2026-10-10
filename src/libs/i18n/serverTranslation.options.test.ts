// @vitest-environment node
import { expect, it, vi } from 'vitest';

import { getServerTranslations } from './serverTranslation';

vi.mock('./server/generated/resources', () => ({
  serverResources: {
    'en-US': { home: { title: 'Default title', body: 'Default body' } },
    'zh-CN': { home: { title: '本地标题' } },
  },
}));

it('lets callers own missing-key fallback without changing the default behavior', () => {
  expect(getServerTranslations('home', 'zh-CN').find('body')).toBe('Default body');
  const copy = getServerTranslations('home', 'zh-CN', { fallbackToDefault: false });
  expect(copy.find('title')).toBe('本地标题');
  expect(copy.find('body')).toBeUndefined();
  expect(copy.t('body')).toBe('body');
});
