'use client';

import { Flexbox } from '@lobehub/ui';
import { AnimatePresence, m as motion } from 'motion/react';
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
  const isHome = !topic;

  if (!isCurrent) return null;

  return (
    <>
      <NavHeader
        right={<WideScreenButton />}
        styles={{
          center: {
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'center',
            minWidth: 0,
          },
          left: { flex: 1, minWidth: 0 },
          right: { flex: 1, minWidth: 0 },
        }}
      />
      <Flexbox
        height={'100%'}
        style={{ flexDirection: 'column', overflow: 'hidden', position: 'relative' }}
        width={'100%'}
      >
        <Flexbox flex={1} style={{ minHeight: 0, overflowY: 'auto' }} width={'100%'}>
          <WideScreenContainer wrapperStyle={{ minHeight: '100%' }}>
            <AnimatePresence initial={false} mode="wait">
              {isHome ? (
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  initial={{ opacity: 0, y: 8 }}
                  key="home-input"
                  transition={{ duration: 0.24, ease: 'easeOut' }}
                >
                  <Flexbox
                    align={'center'}
                    justify={'center'}
                    style={{ minHeight: 'calc(100vh - 180px)' }}
                    width={'100%'}
                  >
                    <PromptInput disableAnimation showTitle />
                  </Flexbox>
                </motion.div>
              ) : (
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  initial={{ opacity: 0, y: 10 }}
                  key="topic-workspace"
                  transition={{ duration: 0.28, ease: 'easeOut' }}
                >
                  <Workspace embedInput={false} />
                </motion.div>
              )}
            </AnimatePresence>
          </WideScreenContainer>
        </Flexbox>
        <AnimatePresence initial={false}>
          {!isHome && (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              initial={{ opacity: 0, y: 8 }}
              key="bottom-input"
              transition={{ delay: 0.04, duration: 0.2, ease: 'easeOut' }}
            >
              <WideScreenContainer style={{ marginTop: -8, paddingBlockEnd: 12 }}>
                <PromptInput disableAnimation showTitle={false} />
              </WideScreenContainer>
            </motion.div>
          )}
        </AnimatePresence>
      </Flexbox>
    </>
  );
});

CreateGenerationPage.displayName = 'CreateGenerationPage';

export default CreateGenerationPage;
