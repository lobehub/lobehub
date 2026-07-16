'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { SkillDetailView, SkillNavKey } from '@/features/CommunitySkillDetail';
import Loading from '@/features/CommunitySkillDetail/Loading';
import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';

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
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const useSkillDetail = useDiscoverStore((s) => s.useFetchSkillDetail);
  const { data, isLoading } = useSkillDetail({ identifier, version });

  if (isLoading) return <Loading />;
  if (!data) return <NotFound />;

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

export const MobileSkillPage = memo<{ mobile?: boolean }>(() => {
  return <SkillDetailPage mobile={true} />;
});

export default SkillDetailPage;
