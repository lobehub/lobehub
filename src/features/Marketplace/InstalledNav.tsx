'use client';

import type { ConnectorVisibility } from '@lobechat/types';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { SlidersHorizontalIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
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

/**
 * The workspace connector tab the sidebar lists, mirroring the installed page
 * (`ToolSettings`): the shared pool unless that page is on its Private tab.
 * A private and a shared connector may share an identifier, so the list and
 * the detail it opens must name the same tab. Outside a workspace (and for
 * skills) there are no tabs.
 */
export const getInstalledVisibility = (
  kind: InstalledKind | undefined,
  workspaceId: string | null | undefined,
  visibilityParam: string | null,
): ConnectorVisibility | undefined => {
  if (kind !== 'connector' || !workspaceId) return undefined;
  return visibilityParam === 'private' ? 'private' : 'public';
};

/**
 * The installed page that opens one item's detail (`?open=<type>:<identifier>`),
 * on the tab the row was listed under so the detail resolves that row.
 */
export const buildInstalledDetailPath = (
  kind: InstalledKind,
  identifier: string,
  type: ToolDetailType,
  visibility?: ConnectorVisibility,
): string => {
  const params = new URLSearchParams({
    [MOBILE_SELECTION_PARAM]: encodeMobileSelection({ identifier, type }),
  });
  if (visibility === 'private') params.set('visibility', visibility);
  return `${INSTALLED_PATHS[kind]}?${params.toString()}`;
};

/**
 * Installed connectors stay in the Marketplace sidebar when the main section changes.
 */
const InstalledNav = memo(() => {
  const { t } = useTranslation('discover');
  const { pathname } = useActiveLocation();
  const [searchParams] = useSearchParams();
  const navigate = useWorkspaceAwareNavigate();
  const sectionTriggerStyle = useSectionTriggerStyle();

  const subPath = getMarketplaceSubPath(pathname);
  const onInstalledPage = subPath === getMarketplaceSubPath(MARKETPLACE_INSTALLED_CONNECTORS_PATH);
  const selectedIdentifier = onInstalledPage
    ? parseMobileSelection(searchParams.get(MOBILE_SELECTION_PARAM))?.identifier
    : undefined;
  const workspaceId = useActiveWorkspaceId();
  const visibility = getInstalledVisibility(
    'connector',
    workspaceId,
    onInstalledPage ? searchParams.get('visibility') : null,
  );

  const handleSelect = useCallback(
    (identifier: string, type: ToolDetailType) => {
      navigate(buildInstalledDetailPath('connector', identifier, type, visibility));
    },
    [navigate, visibility],
  );

  return (
    <Flexbox gap={2} paddingBlock={8} paddingInline={4}>
      <Flexbox horizontal align={'center'} justify={'space-between'} style={sectionTriggerStyle}>
        <SectionTitle>{t('catalog.installed')}</SectionTitle>
        <ActionIcon
          active={onInstalledPage && !selectedIdentifier}
          icon={SlidersHorizontalIcon}
          size={'small'}
          title={t('catalog.manageInstalledConnectors')}
          onClick={() =>
            navigate(
              visibility === 'private'
                ? `${MARKETPLACE_INSTALLED_CONNECTORS_PATH}?visibility=private`
                : MARKETPLACE_INSTALLED_CONNECTORS_PATH,
            )
          }
        />
      </Flexbox>
      <SkillListVariantProvider value={'nav'}>
        <SkillList
          installedOnly
          selectedIdentifier={selectedIdentifier}
          viewMode={'connector'}
          visibility={visibility}
          onSelect={handleSelect}
        />
      </SkillListVariantProvider>
    </Flexbox>
  );
});

InstalledNav.displayName = 'MarketplaceInstalledNav';

export default InstalledNav;
