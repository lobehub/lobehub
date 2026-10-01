import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import enUS from '../../../../locales/en-US/chat.json';
import zhCN from '../../../../locales/zh-CN/chat.json';
import chat from './chat';

describe('share page disclaimer', () => {
  it.each([
    [
      'default',
      chat,
      "Shared by a user. The content reflects their views, not Acme Workspace's, and Acme Workspace takes no responsibility for it.",
    ],
    [
      'en-US',
      enUS,
      "Shared by a user. The content reflects their views, not Acme Workspace's, and Acme Workspace takes no responsibility for it.",
    ],
    [
      'zh-CN',
      zhCN,
      '由用户分享，仅代表其个人观点，不代表 Acme Workspace 立场；Acme Workspace 不对该内容承担责任。',
    ],
  ])('uses the configured brand in both clauses (%s)', async (_, resources, expected) => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { chat: resources } } });

    expect(i18n.t('chat:sharePageDisclaimer', { appName: 'Acme Workspace' })).toBe(expected);
    expect(i18n.t('chat:sharePageDisclaimer', { appName: 'LobeHub' })).toBe(
      expected.replaceAll('Acme Workspace', 'LobeHub'),
    );
  });
});
