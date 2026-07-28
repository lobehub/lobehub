'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useState } from 'react';

import HomeInbox from '@/features/HomeInbox';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import HomeHeader from './HomeHeader';
import HomeModeContent from './HomeModeContent';
import HomePortrait from './HomePortrait';
import InputArea from './InputArea';
import type { HomeMode } from './types';

const styles = createStaticStyles(({ css }) => ({
  // Two rows so the rail's first card shares a baseline with the input: the
  // greeting owns row 1 alone, and row 2 starts both columns together.
  grid: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) 380px;
    gap: 24px 28px;
    align-items: start;

    width: 100%;

    @media (width <= 1100px) {
      grid-template-columns: 1fr;
    }
  `,
  header: css`
    grid-area: 1 / 1;
  `,
  main: css`
    grid-area: 2 / 1;
    min-width: 0;
  `,
  // Stretched, not start-aligned: the portrait anchors to the bottom of the
  // greeting row, so the grid must give it that row's full height to measure from.
  portrait: css`
    grid-area: 1 / 2;
    align-self: stretch;

    @media (width <= 1100px) {
      display: none;
    }
  `,
  // Above the portrait so the agent stands behind the glass, not on top of it.
  rail: css`
    position: relative;
    z-index: 1;

    display: flex;
    grid-area: 2 / 2;
    flex-direction: column;

    min-width: 0;

    @media (width <= 1100px) {
      display: none;
    }
  `,
}));

const Home = memo(() => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const [mode, setMode] = useState<HomeMode>('chat');

  return (
    <Flexbox className={styles.grid}>
      <div className={styles.header}>
        <HomeHeader />
      </div>

      {isLogin && (
        <div className={styles.portrait}>
          <HomePortrait />
        </div>
      )}

      <Flexbox className={styles.main} gap={36}>
        <InputArea mode={mode} onModeChange={setMode} />
        <HomeModeContent mode={mode} />
      </Flexbox>

      {isLogin && (
        <aside className={styles.rail}>
          <HomeInbox variant={'rail'} />
        </aside>
      )}
    </Flexbox>
  );
});

export default Home;
