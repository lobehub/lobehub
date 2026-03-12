'use client';

import { Flexbox } from '@lobehub/ui';
import type { ComponentType } from 'react';
import { memo } from 'react';
import { useMatch } from 'react-router-dom';

import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';

interface CreateGenerationPageProps {
  path: string;
  PromptInput: ComponentType<{ disableAnimation?: boolean; showTitle?: boolean }>;
  Workspace: ComponentType<{ embedInput?: boolean }>;
}

const CreateGenerationPage = memo<CreateGenerationPageProps>(({ path, Workspace, PromptInput }) => {
  const isCurrent = useMatch({ path, end: true });
  if (!isCurrent) return null;

  return (
    <>
      <NavHeader right={<WideScreenButton />} />
      <Flexbox
        height={'100%'}
        style={{ flexDirection: 'column', overflow: 'hidden', position: 'relative' }}
        width={'100%'}
      >
        <Flexbox flex={1} style={{ minHeight: 0, overflowY: 'auto' }} width={'100%'}>
          <WideScreenContainer wrapperStyle={{ minHeight: '100%' }}>
            <Workspace embedInput={false} />
          </WideScreenContainer>
        </Flexbox>
        <WideScreenContainer style={{ paddingBlockEnd: 12 }}>
          <PromptInput disableAnimation showTitle={false} />
        </WideScreenContainer>
      </Flexbox>
    </>
  );
});

CreateGenerationPage.displayName = 'CreateGenerationPage';

export default CreateGenerationPage;
