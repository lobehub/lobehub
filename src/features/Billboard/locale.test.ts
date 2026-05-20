import { describe, expect, it } from 'vitest';

import type { GlobalBillboard, GlobalBillboardItem } from '@/types/serverConfig';

import { resolveBillboardItem, resolveBillboardTitle } from './locale';

const base: GlobalBillboardItem = {
  description: 'Default description',
  id: 1,
  linkLabel: 'Default label',
  title: 'Default title',
};

describe('resolveBillboardItem', () => {
  it('falls back to default fields when i18n is missing', () => {
    expect(resolveBillboardItem(base, 'zh-CN')).toEqual({
      description: 'Default description',
      linkLabel: 'Default label',
      title: 'Default title',
    });
  });

  it('uses the exact locale match when present', () => {
    const item: GlobalBillboardItem = {
      ...base,
      i18n: {
        'zh-CN': { description: '中文描述', linkLabel: '查看', title: '中文标题' },
      },
    };

    expect(resolveBillboardItem(item, 'zh-CN')).toEqual({
      description: '中文描述',
      linkLabel: '查看',
      title: '中文标题',
    });
  });

  it('falls back to base locale when regional variant missing', () => {
    const item: GlobalBillboardItem = {
      ...base,
      i18n: {
        zh: { title: '通用中文标题' },
      },
    };

    expect(resolveBillboardItem(item, 'zh-HK').title).toBe('通用中文标题');
  });

  it('falls back to sibling regional locale when base missing', () => {
    const item: GlobalBillboardItem = {
      ...base,
      i18n: {
        'zh-CN': { title: '简体标题' },
      },
    };

    expect(resolveBillboardItem(item, 'zh-TW').title).toBe('简体标题');
  });

  it('uses default when locale entry exists but specific field missing', () => {
    const item: GlobalBillboardItem = {
      ...base,
      i18n: {
        'ja-JP': { title: '日本語タイトル' },
      },
    };

    expect(resolveBillboardItem(item, 'ja-JP')).toEqual({
      description: 'Default description',
      linkLabel: 'Default label',
      title: '日本語タイトル',
    });
  });

  it('returns null linkLabel when neither locale nor default has it', () => {
    const item: GlobalBillboardItem = {
      ...base,
      linkLabel: null,
    };

    expect(resolveBillboardItem(item, 'en-US').linkLabel).toBeNull();
  });
});

describe('resolveBillboardTitle', () => {
  const baseBillboard: GlobalBillboard = {
    endAt: '2026-12-31T00:00:00.000Z',
    id: 1,
    items: [],
    slug: 'test',
    startAt: '2026-01-01T00:00:00.000Z',
    title: 'Default billboard title',
  };

  it('falls back to default title when i18n is missing', () => {
    expect(resolveBillboardTitle(baseBillboard, 'zh-CN')).toBe('Default billboard title');
  });

  it('uses locale override when present', () => {
    const billboard: GlobalBillboard = {
      ...baseBillboard,
      i18n: { 'zh-CN': { title: '中文标题' } },
    };
    expect(resolveBillboardTitle(billboard, 'zh-CN')).toBe('中文标题');
  });

  it('falls back to sibling regional locale via base code', () => {
    const billboard: GlobalBillboard = {
      ...baseBillboard,
      i18n: { 'zh-CN': { title: '简体标题' } },
    };
    expect(resolveBillboardTitle(billboard, 'zh-TW')).toBe('简体标题');
  });
});
