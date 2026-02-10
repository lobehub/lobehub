import { Flexbox } from '@lobehub/ui';
// import { PencilLineIcon } from 'lucide-react';
import { type FC } from 'react';

import MemoryAnalysis from '@/app/[variants]/(main)/memory/features/MemoryAnalysis';
import MemoryEmpty from '@/app/[variants]/(main)/memory/features/MemoryEmpty';
import { SCROLL_PARENT_ID } from '@/app/[variants]/(main)/memory/features/TimeLineView/useScrollParent';
import Loading from '@/components/Loading/BrandTextLoading';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';
import { useUserMemoryStore } from '@/store/userMemory';

import Persona from './features/Persona';
import PersonaHeader from './features/Persona/PersonaHeader';
import RoleTagCloud from './features/RoleTagCloud';

const Home: FC = () => {
  const useFetchTags = useUserMemoryStore((s) => s.useFetchTags);
  const useFetchPersona = useUserMemoryStore((s) => s.useFetchPersona);
  const roles = useUserMemoryStore((s) => s.roles);
  const persona = useUserMemoryStore((s) => s.persona);

  const { isLoading: isTagsLoading } = useFetchTags();
  const { isLoading: isPersonaLoading } = useFetchPersona();
  // const { EditorModalElement, openEditor } = usePersonaEditor();

  if (isTagsLoading || isPersonaLoading) return <Loading debugId={'Home'} />;

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        right={
          <Flexbox gap={8} horizontal>
            {/* <ActionIcon icon={PencilLineIcon} onClick={openEditor} /> */}
            <MemoryAnalysis iconOnly />
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
          {roles?.length > 0 && <RoleTagCloud tags={roles} />}
          {persona ? (
            <>
              <PersonaHeader />
              <Persona />
            </>
          ) : (
            !roles?.length && (
              <MemoryEmpty>
                <MemoryAnalysis />
              </MemoryEmpty>
            )
          )}
        </WideScreenContainer>
      </Flexbox>
      {/* {EditorModalElement} */}
    </Flexbox>
  );
};

export default Home;
