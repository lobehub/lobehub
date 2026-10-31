import { BRANDING_NAME } from '@lobechat/business-const';
import { describe, expect, it } from 'vitest';

import { createShareT } from '../../src/shell/createShareI18n';
import { shareMetaDescription } from './seo';

describe('shareMetaDescription', () => {
  it('translates through the chat translator', () => {
    const t = createShareT('zh-CN', {
      chat: { 'sharePage.meta.pageDescription': '分享自 {{appName}} 的页面。' },
    });
    expect(shareMetaDescription(t, 'pageDescription')).toBe(`分享自 ${BRANDING_NAME} 的页面。`);
  });

  it('falls back to English copy without a translation', () => {
    expect(shareMetaDescription(createShareT('zh-CN', { chat: {} }), 'topicDescription')).toBe(
      `A conversation shared from ${BRANDING_NAME}.`,
    );
    expect(shareMetaDescription(undefined, 'artifactDescription')).toBe(
      `An artifact shared from ${BRANDING_NAME}.`,
    );
  });
});
