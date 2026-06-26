import { type TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import { getLocalizedConnectorDetail } from './localization';

const createTranslator = (translations: Record<string, string> = {}) =>
  vi.fn(
    (key: string, options?: { defaultValue?: string }) =>
      translations[key] ?? options?.defaultValue ?? key,
  ) as unknown as TFunction<'setting'>;

describe('getLocalizedConnectorDetail', () => {
  it('localizes builtin connector name and description with setting keys', () => {
    const t = createTranslator({
      'tools.builtins.lobe-web-browsing.description': '搜索网页获取最新信息',
      'tools.builtins.lobe-web-browsing.title': '网页浏览',
    });

    const result = getLocalizedConnectorDetail({
      connector: {
        identifier: 'lobe-web-browsing',
        metadata: { description: 'Search the web' },
        name: 'Web Browsing',
        sourceType: 'builtin',
      },
      t,
    });

    expect(result).toEqual({ description: '搜索网页获取最新信息', name: '网页浏览' });
    expect(t).toHaveBeenCalledWith('tools.builtins.lobe-web-browsing.title', {
      defaultValue: 'Web Browsing',
    });
    expect(t).toHaveBeenCalledWith('tools.builtins.lobe-web-browsing.description', {
      defaultValue: 'Search the web',
    });
  });

  it('localizes LobeHub marketplace connector descriptions from provider metadata', () => {
    const t = createTranslator({
      'tools.lobehubSkill.providers.github.description': '连接 GitHub 代码仓库',
    });

    const result = getLocalizedConnectorDetail({
      connector: {
        identifier: 'github',
        metadata: { description: 'Raw GitHub description' },
        name: 'GitHub connector',
        sourceType: 'marketplace',
      },
      lobehubProvider: { description: 'GitHub provider description', label: 'GitHub' },
      t,
    });

    expect(result).toEqual({ description: '连接 GitHub 代码仓库', name: 'GitHub' });
    expect(t).toHaveBeenCalledWith('tools.lobehubSkill.providers.github.description', {
      defaultValue: 'GitHub provider description',
    });
  });

  it('localizes Composio marketplace connector descriptions from app metadata', () => {
    const t = createTranslator({
      'tools.composio.servers.gmail.description': '连接 Gmail 邮箱',
    });

    const result = getLocalizedConnectorDetail({
      composioApp: { description: 'Gmail app description', label: 'Gmail' },
      connector: {
        identifier: 'gmail',
        metadata: { description: 'Raw Gmail description' },
        name: 'Gmail connector',
        sourceType: 'marketplace',
      },
      t,
    });

    expect(result).toEqual({ description: '连接 Gmail 邮箱', name: 'Gmail' });
    expect(t).toHaveBeenCalledWith('tools.composio.servers.gmail.description', {
      defaultValue: 'Gmail app description',
    });
  });

  it('keeps custom connector metadata unchanged', () => {
    const t = createTranslator();

    const result = getLocalizedConnectorDetail({
      connector: {
        identifier: 'custom-http',
        metadata: { description: 'Custom server description' },
        name: 'Custom HTTP',
        sourceType: 'custom',
      },
      t,
    });

    expect(result).toEqual({ description: 'Custom server description', name: 'Custom HTTP' });
    expect(t).not.toHaveBeenCalled();
  });

  it('ignores non-string descriptions', () => {
    const t = createTranslator();

    const result = getLocalizedConnectorDetail({
      connector: {
        identifier: 'custom-http',
        metadata: { description: 42 },
        name: 'Custom HTTP',
        sourceType: 'custom',
      },
      t,
    });

    expect(result).toEqual({ description: undefined, name: 'Custom HTTP' });
  });
});
