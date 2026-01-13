import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';

import MemoryEmpty from '@/app/[variants]/(main)/memory/features/MemoryEmpty';
import { SCROLL_PARENT_ID } from '@/app/[variants]/(main)/memory/features/TimeLineView/useScrollParent';
import Loading from '@/components/Loading/BrandTextLoading';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';
import { useUserMemoryStore } from '@/store/userMemory';

import RoleTagCloud from './features/RoleTagCloud';

const Home: FC = () => {
  const useFetchTags = useUserMemoryStore((s) => s.useFetchTags);
  const roles = useUserMemoryStore((s) => s.roles);
  const { isLoading } = useFetchTags();

  if (isLoading) return <Loading debugId={'Home'} />;

  if (!roles || roles.length === 0) {
    return <MemoryEmpty />;
  }

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        right={<WideScreenButton />}
        style={{
          zIndex: 1,
        }}
      />
      <Flexbox
        height={'100%'}
        id={SCROLL_PARENT_ID}
        style={{ overflowY: 'auto', paddingBottom: '16vh' }}
        width={'100%'}
      >
        <WideScreenContainer gap={32} paddingBlock={48}>
          <RoleTagCloud tags={roles} />
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
};

export default Home;
