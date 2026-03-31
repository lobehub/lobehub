'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router-dom';

import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';

import NotFound from '../components/NotFound';
import { TocProvider } from '../features/Toc/useToc';
import { DetailProvider } from './features/DetailProvider';
import Details from './features/Details';
import Header from './features/Header';
import Loading from './loading';

interface SkillDetailPageProps {
  mobile?: boolean;
}

const SkillDetailPage = memo<SkillDetailPageProps>(({ mobile }) => {
  const params = useParams<{ slug: string }>();
  const identifier = params.slug ?? '';

  const { version } = useQuery() as { version?: string };
  const useSkillDetail = useDiscoverStore((s) => s.useFetchSkillDetail);
  const { data, isLoading } = useSkillDetail({ identifier, version });

  if (isLoading) return <Loading />;
  if (!data) return <NotFound />;

  return (
    <TocProvider>
      <DetailProvider config={data}>
        <Flexbox data-testid="skill-detail-content" gap={16}>
          <Header mobile={mobile} />
          <Details mobile={mobile} />
        </Flexbox>
      </DetailProvider>
    </TocProvider>
  );
});

export const MobileSkillPage = memo<{ mobile?: boolean }>(() => {
  return <SkillDetailPage mobile={true} />;
});

export default SkillDetailPage;
