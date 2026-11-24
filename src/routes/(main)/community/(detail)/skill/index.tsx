'use client';

import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, useCallback } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { SkillDetailView, SkillNavKey } from '@/features/CommunitySkillDetail';
import { catalogStyles } from '@/features/Marketplace/Catalog/styles';
import MarketplaceSkillDetail from '@/features/Marketplace/Skills/SkillDetail';
import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { skillSelectors } from '@/store/discover/selectors';

import NotFound from '../components/NotFound';

interface SkillDetailPageProps {
  mobile?: boolean;
}

/** Tab keys this route emitted before the redesign — keep old shared links working */
const LEGACY_TAB_ALIASES: Record<string, SkillNavKey> = {
  installation: SkillNavKey.Install,
  related: SkillNavKey.Overview,
  resources: SkillNavKey.Install,
  skill: SkillNavKey.Overview,
  version: SkillNavKey.Overview,
};

const SkillDetailPage = memo<SkillDetailPageProps>(({ mobile }) => {
  const params = useParams<{ slug: string }>();
  const identifier = params.slug ?? '';

  const { version } = useQuery() as { version?: string };
  const [searchParams, setSearchParams] = useSearchParams();
  const { state } = useLocation();
  const activeTabParam = searchParams.get('activeTab');
  const activeTab = Object.values(SkillNavKey).includes(activeTabParam as SkillNavKey)
    ? (activeTabParam as SkillNavKey)
    : (LEGACY_TAB_ALIASES[activeTabParam ?? ''] ?? SkillNavKey.Overview);

  const handleTabChange = useCallback(
    (tab: SkillNavKey) => {
      const next = new URLSearchParams(searchParams);
      if (tab === SkillNavKey.Overview) {
        next.delete('activeTab');
      } else {
        next.set('activeTab', tab);
      }
      setSearchParams(next, { replace: true, state });
    },
    [searchParams, setSearchParams, state],
  );

  const useSkillDetail = useDiscoverStore((s) => s.useFetchSkillDetail);
  const { error, isLoading, mutate, queryKey } = useSkillDetail({ identifier, version });
  const data = useDiscoverStore(skillSelectors.skillDetail(queryKey));
  if (data === undefined) {
    if (isLoading) return <RouteLoading />;
    if (error) return <AsyncError error={error} variant={'page'} onRetry={() => void mutate()} />;
    return <NotFound />;
  }

  return (
    <Flexbox data-testid="skill-detail-content" gap={16}>
      <SkillDetailView
        activeTab={activeTab}
        data={data}
        mobile={mobile}
        onTabChange={handleTabChange}
      />
    </Flexbox>
  );
});

export const MobileSkillPage = (_props: { mobile?: boolean }) => {
  return <SkillDetailPage mobile={true} />;
};

/**
 * Desktop: the skill's page from the Marketplace's Skills design — install,
 * ratings, the mock chat, which of my assistants have it on, and SKILL.md.
 */
const DesktopSkillPage = memo(() => {
  const { slug = '' } = useParams<{ slug: string }>();
  // The detail layout's header already carries the back arrow; the centered
  // column matches the Agent and App pages.
  return (
    <div
      data-testid="skill-detail-content"
      {...stylex.props(catalogStyles.frame, catalogStyles.pageTop)}
    >
      <MarketplaceSkillDetail identifier={slug} key={slug} />
    </div>
  );
});

DesktopSkillPage.displayName = 'DesktopSkillPage';

export default DesktopSkillPage;
