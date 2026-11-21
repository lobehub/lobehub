'use client';

import { Tabs } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { isMobileSurface } from '@/utils/mobileSurface';

import {
  MARKETPLACE_APPS_PATH,
  MARKETPLACE_INSTALLED_CONNECTORS_PATH,
  MARKETPLACE_INSTALLED_MCP_PATH,
  MARKETPLACE_INSTALLED_SKILLS_PATH,
  MARKETPLACE_MCP_PATH,
  MARKETPLACE_SKILL_PATH,
} from './paths';
import { pillTabClassNames } from './pillTabs';

export type CatalogView = 'discover' | 'installed';
export type CatalogKind = 'connector' | 'mcp' | 'skill';

export const CATALOG_VIEW_PATHS: Record<CatalogKind, Record<CatalogView, string>> = {
  mcp: { discover: MARKETPLACE_MCP_PATH, installed: MARKETPLACE_INSTALLED_MCP_PATH },
  connector: {
    discover: MARKETPLACE_APPS_PATH,
    installed: MARKETPLACE_INSTALLED_CONNECTORS_PATH,
  },
  skill: {
    discover: MARKETPLACE_SKILL_PATH,
    installed: MARKETPLACE_INSTALLED_SKILLS_PATH,
  },
};

const styles = stylex.create({
  root: { flexShrink: 0 },
  // Under the installed list header: aligns with the header's 12px inset, and
  // its 8px bottom + 12px give the Codex 20px from description to tabs.
  inset: { paddingBlockStart: '12px', paddingInline: '12px' },
});

interface CatalogViewTabsProps {
  active: CatalogView;
  /** Indent to the list page header (installed page); the catalog column needs none. */
  inset?: boolean;
  kind: CatalogKind;
}

/** The mobile catalog switcher. Desktop collections have dedicated sidebar links. */
const CatalogViewTabs = memo<CatalogViewTabsProps>(({ active, inset, kind }) => {
  const { t } = useTranslation('discover');
  const navigate = useWorkspaceAwareNavigate();
  const { showMarket } = useServerConfigStore(featureFlagsSelectors);

  const items = useMemo(
    () => [
      { key: 'discover', label: t('skillView.discover') },
      { key: 'installed', label: t('skillView.installed') },
    ],
    [t],
  );

  if (!showMarket || !isMobileSurface()) return null;

  return (
    <div {...stylex.props(styles.root, inset && styles.inset)}>
      <Tabs
        activeKey={active}
        classNames={pillTabClassNames}
        items={items}
        size={'middle'}
        variant={'rounded'}
        onChange={(key) => {
          if (key === active) return;
          navigate(CATALOG_VIEW_PATHS[kind][key as CatalogView]);
        }}
      />
    </div>
  );
});

CatalogViewTabs.displayName = 'MarketplaceCatalogViewTabs';

export default CatalogViewTabs;
