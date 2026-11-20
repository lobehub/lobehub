'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { SlidersHorizontalIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import SectionTitle, { useSectionTriggerStyle } from '@/features/NavPanel/components/SectionTitle';
import type { ToolDetailType } from '@/features/Settings/skill/features/SkillDetail';
import SkillList from '@/features/Settings/skill/features/SkillList';
import { SkillListVariantProvider } from '@/features/Settings/skill/features/SkillListRow';
import {
  encodeMobileSelection,
  MOBILE_SELECTION_PARAM,
  parseMobileSelection,
} from '@/features/Settings/skill/mobileSelection';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';

import {
  getMarketplaceSubPath,
  MARKETPLACE_INSTALLED_CONNECTORS_PATH,
  MARKETPLACE_INSTALLED_SKILLS_PATH,
} from './paths';

export type InstalledKind = 'connector' | 'skill';

const INSTALLED_PATHS: Record<InstalledKind, string> = {
  connector: MARKETPLACE_INSTALLED_CONNECTORS_PATH,
  skill: MARKETPLACE_INSTALLED_SKILLS_PATH,
};

/** The same pages as sub paths of the Marketplace root (`getMarketplaceSubPath`). */
const INSTALLED_SUB_PATHS: Record<InstalledKind, string> = {
  connector: 'connector/installed',
  skill: 'skill/installed',
};

/**
 * Which library the sidebar lists for a Marketplace sub path: Skills pages
 * show installed skills; Connectors and MCP pages show installed connectors;
 * every other section (Home, Agents) has none.
 */
export const getInstalledKind = (subPath?: string): InstalledKind | undefined => {
  const section = subPath?.split('/')[0];
  if (section === 'skill') return 'skill';
  if (section === 'connector' || section === 'mcp') return 'connector';
  return undefined;
};

/** The installed page that opens one item's detail (`?open=<type>:<identifier>`). */
export const buildInstalledDetailPath = (
  kind: InstalledKind,
  identifier: string,
  type: ToolDetailType,
): string =>
  `${INSTALLED_PATHS[kind]}?${MOBILE_SELECTION_PARAM}=${encodeURIComponent(
    encodeMobileSelection({ identifier, type }),
  )}`;

/**
 * The sidebar's `Installed` section, as in Codex Customize: under the
 * Skills / Connectors entries it lists what is already in the library for the
 * entry in view. A row opens that item's detail on the installed page; the
 * header action opens the full installed manager (search, import, add).
 */
const InstalledNav = memo(() => {
  const { t } = useTranslation('discover');
  const { pathname } = useActiveLocation();
  const [searchParams] = useSearchParams();
  const navigate = useWorkspaceAwareNavigate();
  const sectionTriggerStyle = useSectionTriggerStyle();

  const subPath = getMarketplaceSubPath(pathname);
  const kind = getInstalledKind(subPath);
  const onInstalledPage = !!kind && subPath === INSTALLED_SUB_PATHS[kind];
  const selectedIdentifier = onInstalledPage
    ? parseMobileSelection(searchParams.get(MOBILE_SELECTION_PARAM))?.identifier
    : undefined;

  const handleSelect = useCallback(
    (identifier: string, type: ToolDetailType) => {
      if (!kind) return;
      navigate(buildInstalledDetailPath(kind, identifier, type));
    },
    [kind, navigate],
  );

  if (!kind) return null;

  const manageLabel = t(
    kind === 'skill' ? 'catalog.manageInstalledSkills' : 'catalog.manageInstalledConnectors',
  );

  return (
    <Flexbox gap={2} paddingBlock={8} paddingInline={4}>
      <Flexbox horizontal align={'center'} justify={'space-between'} style={sectionTriggerStyle}>
        <SectionTitle>{t('catalog.installed')}</SectionTitle>
        <ActionIcon
          active={onInstalledPage && !selectedIdentifier}
          icon={SlidersHorizontalIcon}
          size={'small'}
          title={manageLabel}
          onClick={() => navigate(INSTALLED_PATHS[kind])}
        />
      </Flexbox>
      <SkillListVariantProvider value={'nav'}>
        <SkillList
          installedOnly
          // Remount per library so the connector and skill lists keep no state across.
          key={kind}
          selectedIdentifier={selectedIdentifier}
          viewMode={kind}
          onSelect={handleSelect}
        />
      </SkillListVariantProvider>
    </Flexbox>
  );
});

InstalledNav.displayName = 'MarketplaceInstalledNav';

export default InstalledNav;
