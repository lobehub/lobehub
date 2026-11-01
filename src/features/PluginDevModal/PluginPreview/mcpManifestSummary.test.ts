import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import enUS from '../../../../locales/en-US/plugin.json';
import zhCN from '../../../../locales/zh-CN/plugin.json';
import { getMcpManifestSummary } from './mcpManifestSummary';

const i18n = createInstance();
await i18n.init({
  fallbackLng: 'en-US',
  resources: { 'en-US': { plugin: enUS }, 'zh-CN': { plugin: zhCN } },
});

const summary = (manifest: Parameters<typeof getMcpManifestSummary>[0], locale = 'en-US') =>
  getMcpManifestSummary(manifest, i18n.getFixedT(locale, 'plugin'), locale);

describe('MCP preview capability summary', () => {
  it.each([undefined, []])('omits missing or empty capabilities (%s)', (empty) => {
    expect(summary({ api: [{}, {}, {}], prompts: empty, resources: empty })).toBe('3 tools');
  });

  it('uses singular counts and a localized list for mixed capabilities', () => {
    expect(summary({ api: [{}], prompts: [{}], resources: [{}] })).toBe(
      '1 prompt, 1 resource, and 1 tool',
    );
    expect(summary({ api: [{}, {}], prompts: [{}, {}], resources: [{}, {}] })).toBe(
      '2 prompts, 2 resources, and 2 tools',
    );
  });

  it('handles a successful connection with no capabilities', () => {
    expect(summary({ api: [], prompts: [], resources: [] })).toBe(
      'No tools, prompts, or resources',
    );
  });

  it('does not require tools when the server only provides prompts or resources', () => {
    expect(summary({ api: [], prompts: [{}] })).toBe('1 prompt');
    expect(summary({ api: [], resources: [{}] })).toBe('1 resource');
  });

  it('translates counts and the empty state into Chinese', () => {
    expect(summary({ api: [{}, {}, {}] }, 'zh-CN')).toBe('3 个工具');
    expect(summary({ api: [{}], prompts: [{}], resources: [{}] }, 'zh-CN')).toBe(
      '1 个提示词、1 个资源和1 个工具',
    );
    expect(summary({ api: [] }, 'zh-CN')).toBe('没有工具、提示词或资源');
  });
});
