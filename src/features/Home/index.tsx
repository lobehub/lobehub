'use client';

import { Flexbox } from '@lobehub/ui';
import { ScrollArea } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback, useState } from 'react';

import HomeInbox from '@/features/HomeInbox';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import HomeHeader from './HomeHeader';
import HomeModeContent from './HomeModeContent';
import HomePortrait from './HomePortrait';
import InputArea from './InputArea';
import type { HomeMode } from './types';

/** Mirrors the row hover bleed in HomeModeContent; the viewport would clip it. */
const ROW_BLEED = 10;

/** ScrollArea's content node ships its own gap / font-size — neutralize both. */
const scrollContent = {
  display: 'block',
  fontSize: 'inherit',
  gap: 0,
  lineHeight: 'inherit',
  paddingBlockEnd: 24,
} as const;

/** Gutter the rail's scrollbar lives in, so it never sits over a card. */
const RAIL_GUTTER = 14;
const RAIL_CARD_WIDTH = 380;

const MAIN_CONTENT_STYLE = { ...scrollContent, paddingInline: ROW_BLEED };
const RAIL_CONTENT_STYLE = { ...scrollContent };
const SINGLE_COLUMN_STYLE = { gridTemplateColumns: 'minmax(0, 1fr)' } as const;

const styles = createStaticStyles(({ css }) => ({
  // Row 1 (greeting + portrait) is fixed; row 2 gives each column its own
  // scroll viewport, so the rail and the task list scroll independently.
  grid: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) ${RAIL_CARD_WIDTH + RAIL_GUTTER}px;
    grid-template-rows: auto minmax(0, 1fr);
    flex: 1;
    gap: 24px 28px;

    width: 100%;
    min-height: 0;

    @media (width <= 1100px) {
      overflow-y: auto;
      grid-template-columns: 1fr;
      grid-template-rows: auto auto auto;
    }
  `,
  header: css`
    grid-area: 1 / 1;
  `,
  main: css`
    grid-area: 2 / 1;
    min-width: 0;
    min-height: 0;
  `,
  mainScroll: css`
    flex: 1;
    min-height: 0;
    margin-inline: -${ROW_BLEED}px;

    @media (width <= 1100px) {
      flex: none;
    }
  `,
  portrait: css`
    grid-area: 1 / 2;

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

    min-width: 0;
    min-height: 0;
    padding-inline-end: ${RAIL_GUTTER}px;

    @media (width <= 1100px) {
      grid-area: 3 / 1;
      justify-self: end;
      width: min(100%, ${RAIL_CARD_WIDTH + RAIL_GUTTER}px);
    }
  `,
  railScroll: css`
    flex: 1;
    min-height: 0;

    @media (width <= 1100px) {
      flex: none;
      width: 100%;
    }
  `,
}));

const Home = memo(() => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const [mode, setMode] = useState<HomeMode>('chat');
  const [inputValue, setInputValue] = useState('');

  const handleInputValueChange = useCallback((value: string) => {
    setInputValue(value);
    useChatStore.setState({ inputMessage: value });
  }, []);

  const handleSuggestionSelect = useCallback(
    (prompt: string) => {
      handleInputValueChange(prompt);

      const editor = useChatStore.getState().mainInputEditor;
      editor?.instance?.setDocument('markdown', prompt);
      editor?.focus();
    },
    [handleInputValueChange],
  );

  return (
    <Flexbox className={styles.grid} style={isLogin ? undefined : SINGLE_COLUMN_STYLE}>
      <div className={styles.header}>
        <HomeHeader />
      </div>

      {isLogin && (
        <div className={styles.portrait}>
          <HomePortrait />
        </div>
      )}

      <Flexbox className={styles.main} gap={24}>
        <InputArea
          inputValue={inputValue}
          mode={mode}
          onInputValueChange={handleInputValueChange}
          onModeChange={setMode}
        />
        <ScrollArea
          disableContentFit
          scrollFade
          className={styles.mainScroll}
          contentProps={{ style: MAIN_CONTENT_STYLE }}
        >
          <HomeModeContent mode={mode} onSuggestionSelect={handleSuggestionSelect} />
        </ScrollArea>
      </Flexbox>

      {isLogin && (
        <aside className={styles.rail}>
          {/* No scrollFade: its mask would make the viewport a backdrop root
              and the cards' glass would stop sampling the portrait behind it. */}
          <ScrollArea
            disableContentFit
            className={styles.railScroll}
            contentProps={{ style: RAIL_CONTENT_STYLE }}
          >
            <HomeInbox variant={'rail'} />
          </ScrollArea>
        </aside>
      )}
    </Flexbox>
  );
});

export default Home;
