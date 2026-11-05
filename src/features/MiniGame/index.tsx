'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { miniGameActions } from '@/store/miniGame';

import GameStage from './GameStage';
import StatusBar from './StatusBar';

/**
 * The playable yard. While mounted the game counts as open: each message the
 * user sends carries its snapshot and enables the agent's game tool.
 */
const MiniGame = memo(() => {
  const { t } = useTranslation('chat');

  useEffect(() => {
    miniGameActions.setOpen(true);
    return () => miniGameActions.setOpen(false);
  }, []);

  return (
    <Flexbox gap={12} padding={16}>
      <GameStage />
      <StatusBar />
      <Text fontSize={12} type={'secondary'}>
        {t('miniGame.hint')}
      </Text>
    </Flexbox>
  );
});

MiniGame.displayName = 'MiniGame';

export default MiniGame;
