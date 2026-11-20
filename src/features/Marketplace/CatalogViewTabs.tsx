'use client';

import { Tabs } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { isMobileSurface } from '@/utils/mobileSurface';

import {
  MARKETPLACE_CONNECTOR_PATH,
  MARKETPLACE_INSTALLED_CONNECTORS_PATH,
  MARKETPLACE_INSTALLED_SKILLS_PATH,
  MARKETPLACE_SKILL_PATH,
} from './paths';
import { pillTabClassNames } from './pillTabs';

export type CatalogView = 'discover' | 'installed';
export type CatalogKind = 'connector' | 'skill';

export const CATALOG_VIEW_PATHS: Record<CatalogKind, Record<CatalogView, string>> = {
  connector: {
    discover: MARKETPLACE_CONNECTOR_PATH,
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

/**
 * Switches a Marketplace entry between its public catalog (Discover) and its
 * management page (Installed): Skills (`/marketplace/skill[/installed]`) and
 * Connectors, which merges the MCP catalog with the connector manager
 * (`/marketplace/connector[/installed]`).
 * With the market disabled only the installed view exists, so no tabs render.
 * Desktop has no tabs either: the sidebar lists the installed items under the
 * Skills / Connectors entries (Codex Customize), so only mobile, which has no
 * sidebar, switches views here.
 */
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
