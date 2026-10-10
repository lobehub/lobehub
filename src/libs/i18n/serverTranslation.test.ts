// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createServerTranslator } from './server/render';
import { getServerTranslations, translation } from './serverTranslation';

// Keep renderer tests runnable before the build-time projection exists.
vi.mock('./server/generated/resources', async () => ({
  serverResources: {
    'en-US': {
      home: (await import('@/../locales/en-US/home.json')).default,
    },
    'zh-CN': {
      heterogeneousError: (await import('@/../locales/zh-CN/heterogeneousError.json')).default,
      home: (await import('@/../locales/zh-CN/home.json')).default,
    },
  },
}));

describe('server translations', () => {
  it('renders real non-default language copy', async () => {
    const { t } = await translation('home', 'zh-CN');
    expect(t('brief.action.openGoal')).toBe('查看目标');
    expect(t('brief.action.openGoal')).not.toBe(
      getServerTranslations('home', 'en-US').t('brief.action.openGoal'),
    );
  });
  it('falls back per key and when a language is absent', () => {
    const resources = {
      'en-US': { home: { title: 'Title', body: 'Hello {{name}}, {{name}}' } },
      'fr-FR': { home: { title: 'Titre' } },
    };
    const copy = createServerTranslator(resources, 'home', 'fr-FR', 'en-US');
    expect(copy.t('title')).toBe('Titre');
    expect(copy.t('body', { name: '$&' })).toBe('Hello $&, $&');
    expect(copy.t('body', { name: '{{other}}', other: 'Replaced' })).toBe(
      'Hello {{other}}, {{other}}',
    );
    expect(copy.find('missing')).toBeUndefined();
    const localOnly = createServerTranslator(resources, 'home', 'fr-FR', 'fr-FR');
    expect(localOnly.find('body')).toBeUndefined();
    expect(localOnly.find('title')).toBe('Titre');
    expect(copy.t('missing')).toBe('missing');
    expect(copy.find('constructor')).toBeUndefined();
    expect(createServerTranslator(resources, 'home', 'zz', 'en-US').t('title')).toBe('Title');
  });
  it('renders bot error copy with interpolation', () => {
    const copy = getServerTranslations('heterogeneousError', 'zh-CN');
    expect(copy.t('heterogeneous.auth_required.title')).toBe('需要重新登录');
    expect(copy.t('heterogeneous.auth_required.description', { agent: 'Codex' })).toContain(
      'Codex',
    );
  });
});
