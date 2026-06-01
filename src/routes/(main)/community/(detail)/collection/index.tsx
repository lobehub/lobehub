'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router-dom';

import { useDiscoverStore } from '@/store/discover';

import NotFound from '../components/NotFound';
import Hero from './features/Hero';
import InstallCTA from './features/InstallCTA';
import MoreCollections from './features/MoreCollections';
import SkillsList from './features/SkillsList';
import Loading from './loading';

interface CollectionDetailPageProps {
  mobile?: boolean;
}

const CollectionDetailPage = memo<CollectionDetailPageProps>(({ mobile }) => {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? '';

  const useFetchSkillCollectionDetail = useDiscoverStore((s) => s.useFetchSkillCollectionDetail);
  const { data, isLoading } = useFetchSkillCollectionDetail({ slug });

  if (isLoading) return <Loading />;
  if (!data) return <NotFound />;

  return (
    <Flexbox data-testid="collection-detail-content" gap={40} width={'100%'}>
      <Hero
        cover={data.cover}
        createdAt={data.createdAt}
        description={data.description}
        itemCount={data.itemCount}
        mobile={mobile}
        summary={data.summary}
        title={data.title}
        updatedAt={data.updatedAt}
      />
      <SkillsList skills={data.items} />
      {data.items.length > 0 && <InstallCTA collectionTitle={data.title} skills={data.items} />}
      <MoreCollections currentSlug={slug} />
    </Flexbox>
  );
});

export const MobileCollectionPage = memo<{ mobile?: boolean }>(() => {
  return <CollectionDetailPage mobile={true} />;
});

export default CollectionDetailPage;
