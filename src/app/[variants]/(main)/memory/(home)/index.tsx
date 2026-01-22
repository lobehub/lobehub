import { Flexbox } from '@lobehub/ui';
// import { PencilLineIcon } from 'lucide-react';
import { type FC } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';
import { useUserMemoryStore } from '@/store/userMemory';

import MemoryEmpty from '../features/MemoryEmpty';
import { SCROLL_PARENT_ID } from '../features/TimeLineView/useScrollParent';
import Persona from './features/Persona';
import PersonaHeader from './features/Persona/PersonaHeader';
import RoleTagCloud from './features/RoleTagCloud';

const Home: FC = () => {
  const useFetchTags = useUserMemoryStore((s) => s.useFetchTags);
  const roles = useUserMemoryStore((s) => s.roles);
  const { isLoading } = useFetchTags();
  // const { EditorModalElement, openEditor } = usePersonaEditor();

  if (isLoading) return <Loading debugId={'Home'} />;

  if (!roles || roles.length === 0) {
    return <MemoryEmpty />;
  }

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        right={
          <Flexbox gap={8} horizontal>
            {/* <ActionIcon icon={PencilLineIcon} onClick={openEditor} /> */}
            <WideScreenButton />
          </Flexbox>
        }
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
          <PersonaHeader />
          <RoleTagCloud tags={roles} />
          <Persona />
        </WideScreenContainer>
      </Flexbox>
      {/* {EditorModalElement} */}
    </Flexbox>
  );
};

export default Home;
