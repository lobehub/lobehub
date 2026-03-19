'use client';

import { Flexbox } from '@lobehub/ui';
import type { ComponentType } from 'react';
import { memo } from 'react';
import { useMatch } from 'react-router-dom';

import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';
import { useQueryState } from '@/hooks/useQueryParam';

interface CreateGenerationPageProps {
  path: string;
  PromptInput: ComponentType<{ disableAnimation?: boolean; showTitle?: boolean }>;
  Workspace: ComponentType<{ embedInput?: boolean }>;
}

const CreateGenerationPage = memo<CreateGenerationPageProps>(({ path, Workspace, PromptInput }) => {
  const isCurrent = useMatch({ path, end: true });
  const [topic] = useQueryState('topic');

  if (!isCurrent) return null;
  const isHome = !topic;

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
            {isHome ? (
              <Flexbox
                align={'center'}
                justify={'center'}
                style={{ minHeight: 'calc(100vh - 180px)' }}
                width={'100%'}
              >
                <PromptInput disableAnimation showTitle />
              </Flexbox>
            ) : (
              <Workspace embedInput={false} />
            )}
          </WideScreenContainer>
        </Flexbox>
        {!isHome && (
          <WideScreenContainer style={{ marginTop: -8, paddingBlockEnd: 12 }}>
            <PromptInput disableAnimation showTitle={false} />
          </WideScreenContainer>
        )}
      </Flexbox>
    </>
  );
});

CreateGenerationPage.displayName = 'CreateGenerationPage';

export default CreateGenerationPage;
