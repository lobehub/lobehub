import { getConnectorCatalog, RecommendedSkillType } from '@lobechat/const';
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import zhSetting from '../../../../../locales/zh-CN/setting.json';
import {
  buildIntegrationItems,
  countConnectorTabItems,
  getVisibleSectionItems,
  isSectionExpandable,
  matchesConnectorKeyword,
  matchesIntegrationKeyword,
  partitionByInstalled,
  SECTION_PREVIEW_LIMIT,
} from './connectorSections';

const noConnectors = { composio: false, lobehub: false };

describe('countConnectorTabItems', () => {
  it('counts an installed custom MCP connector when the other sources are empty', () => {
    expect(
      countConnectorTabItems({
        customConnectors: [{ identifier: 'private-mcp' }],
        integrations: [],
        marketplaceConnectors: [],
      }),
    ).toBe(1);
  });
});

describe('buildIntegrationItems', () => {
  const pageOnly = {
    connectorAvailability: noConnectors,
    isComposioActive: () => false,
    isLobehubConnected: () => false,
    pageOnlyProviderIds: ['github', 'linear'],
  };
  const ids = (items: ReturnType<typeof buildIntegrationItems>) =>
    items.map((item) => (item.type === 'lobehub' ? item.provider.id : item.serverType.identifier));

  it('keeps pages for integrations on a deployment without LobeHub connectors', () => {
    expect(ids(buildIntegrationItems(pageOnly))).toEqual(['github', 'linear']);
  });

  it('does not list a page twice when LobeHub connectors are on', () => {
    const listed = ids(
      buildIntegrationItems({
        ...pageOnly,
        connectorAvailability: { composio: false, lobehub: true },
      }),
    );

    expect(listed.filter((id) => id === 'github')).toHaveLength(1);
    expect(listed.filter((id) => id === 'linear')).toHaveLength(1);
  });

  it('omits builtin recommendations from the connector catalog', () => {
    const fixtures = {
      connectorAvailability: noConnectors,
      isComposioActive: () => false,
      isLobehubConnected: () => false,
      recommendedSkills: [{ id: 'lobe-calculator', type: RecommendedSkillType.Builtin }],
    };
    expect(buildIntegrationItems(fixtures)).toEqual([]);
  });

  it('adds LobeHub OAuth providers only when that system is enabled', () => {
    const base = {
      isComposioActive: () => false,
      isLobehubConnected: () => false,
      recommendedSkills: [],
    };
    expect(buildIntegrationItems({ ...base, connectorAvailability: noConnectors })).toEqual([]);
    const withLobehub = buildIntegrationItems({
      ...base,
      connectorAvailability: { composio: false, lobehub: true },
    });
    expect(withLobehub.length).toBeGreaterThan(0);
    expect(withLobehub.every((i) => i.type === 'lobehub')).toBe(true);
  });
});

describe('matchesConnectorKeyword', () => {
  it('matches any field case-insensitively and ignores surrounding spaces', () => {
    expect(matchesConnectorKeyword('  GEN ', ['Image Generation', undefined])).toBe(true);
    expect(matchesConnectorKeyword('notion', ['GitHub', 'lobe-github', null])).toBe(false);
  });

  it('matches everything when the keyword is empty', () => {
    expect(matchesConnectorKeyword('', [])).toBe(true);
    expect(matchesConnectorKeyword(undefined, ['x'])).toBe(true);
  });
});

describe('matchesIntegrationKeyword', () => {
  const catalog = getConnectorCatalog({ composio: true, lobehub: true });

  it.each([
    ['电子邮件', ['gmail']],
    ['版本控制', ['github']],
    ['free email service', ['gmail']],
    ['version control', ['github']],
    ['  GMAIL  ', ['gmail']],
    ['google-calendar', ['google-calendar']],
    ['不存在的连接器', []],
  ])(
    'searches localized descriptions, original descriptions and names: %s',
    async (keyword, ids) => {
      const i18n = createInstance();
      await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { setting: zhSetting } } });

      const matches = catalog.filter((item) =>
        matchesIntegrationKeyword(item, keyword, i18n.getFixedT('zh-CN', 'setting')),
      );

      expect(
        matches.map((item) =>
          item.type === 'lobehub' ? item.provider.id : item.serverType.identifier,
        ),
      ).toEqual(ids);
    },
  );

  it('keeps catalog descriptions searchable when translations are unavailable', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en-US', resources: {} });
    const t = i18n.getFixedT('en-US', 'setting');

    for (const item of catalog) {
      const description =
        item.type === 'lobehub' ? item.provider.description : item.serverType.description;
      expect(matchesIntegrationKeyword(item, description, t)).toBe(true);
    }
  });
});

describe('partitionByInstalled', () => {
  it('keeps the order on both sides', () => {
    expect(partitionByInstalled([1, 2, 3, 4, 5], (n) => n % 2 === 1)).toEqual({
      available: [2, 4],
      installed: [1, 3, 5],
    });
  });
});

describe('getVisibleSectionItems', () => {
  const items = Array.from({ length: SECTION_PREVIEW_LIMIT + 3 }, (_, i) => i);

  it('previews the first rows of a long group and counts the rest', () => {
    const { hiddenCount, visible } = getVisibleSectionItems(items, false);
    expect(visible).toHaveLength(SECTION_PREVIEW_LIMIT);
    expect(hiddenCount).toBe(3);
  });

  it('shows everything when expanded or short', () => {
    expect(getVisibleSectionItems(items, true)).toEqual({ hiddenCount: 0, visible: items });
    expect(getVisibleSectionItems([1, 2], false)).toEqual({ hiddenCount: 0, visible: [1, 2] });
  });
});

describe('isSectionExpandable', () => {
  it('turns the heading into the toggle only when rows are hidden', () => {
    expect(isSectionExpandable({ expanded: false, hiddenCount: 3, searching: false })).toBe(true);
    expect(isSectionExpandable({ expanded: false, hiddenCount: 0, searching: false })).toBe(false);
  });

  it('keeps the toggle on an expanded group so it can fold back', () => {
    expect(isSectionExpandable({ expanded: true, hiddenCount: 0, searching: false })).toBe(true);
  });

  it('drops the toggle while searching, which already lists every hit', () => {
    expect(isSectionExpandable({ expanded: false, hiddenCount: 3, searching: true })).toBe(false);
    expect(isSectionExpandable({ expanded: true, hiddenCount: 0, searching: true })).toBe(false);
  });
});
