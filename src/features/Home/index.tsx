'use client';

import { Flexbox } from '@lobehub/ui';
import { ScrollArea } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useCallback, useState } from 'react';

import HomeInbox from '@/features/HomeInbox';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import HomeHeader from './HomeHeader';
import HomeModeContent from './HomeModeContent';
import HomePortrait from './HomePortrait';
import InputArea from './InputArea';
import RailToggle from './RailToggle';
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
const RAIL_COLUMN_GAP = 28;
/** Keep the main scrollbar off the content edge and centered in the column gap. */
const MAIN_SCROLLBAR_OFFSET = RAIL_COLUMN_GAP / 2;
const RAIL_EXIT_OFFSET = 24;
const RAIL_TRANSITION_DURATION = 220;
const COLLAPSED_CONTENT_OFFSET = (RAIL_CARD_WIDTH + RAIL_GUTTER + RAIL_COLUMN_GAP) / 2;

const MAIN_CONTENT_STYLE = { ...scrollContent, paddingInline: ROW_BLEED };
const RAIL_CONTENT_STYLE = { ...scrollContent, paddingInlineEnd: RAIL_GUTTER };

const styles = createStaticStyles(({ css }) => ({
  // Row 1 (greeting + portrait) is fixed; row 2 gives each column its own
  // scroll viewport, so the rail and the task list scroll independently.
  grid: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) ${RAIL_CARD_WIDTH + RAIL_GUTTER}px;
    grid-template-rows: auto minmax(0, 1fr);
    flex: 1;
    gap: 24px ${RAIL_COLUMN_GAP}px;

    width: 100%;
    min-height: 0;

    @media (width <= 1100px) {
      overflow-y: auto;
      grid-template-columns: 1fr;
      grid-template-rows: auto auto auto;
    }
  `,
  content: css`
    transition: transform ${RAIL_TRANSITION_DURATION}ms ease-out;

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  contentCentered: css`
    @media (width > 1100px) {
      transform: translateX(${COLLAPSED_CONTENT_OFFSET}px);

      &:dir(rtl) {
        transform: translateX(-${COLLAPSED_CONTENT_OFFSET}px);
      }
    }
  `,
  header: css`
    grid-area: 1 / 1;
  `,
  inputArea: css`
    position: relative;
    min-width: 0;
  `,
  main: css`
    position: relative;
    grid-area: 2 / 1;
    min-width: 0;
    min-height: 0;
  `,
  railToggle: css`
    position: absolute;
    z-index: 3;
    inset-block-start: 50%;
    inset-inline-end: -23px;
    transform: translateY(-50%);

    @media (width <= 1100px) {
      display: none;
    }
  `,
  mainScroll: css`
    flex: 1;
    min-height: 0;
    margin-inline: -${ROW_BLEED}px;

    @media (width <= 1100px) {
      flex: none;
    }
  `,
  mainScrollbar: css`
    @media (width > 1100px) {
      transform: translateX(${MAIN_SCROLLBAR_OFFSET}px);

      &:dir(rtl) {
        transform: translateX(-${MAIN_SCROLLBAR_OFFSET}px);
      }
    }
  `,
  portrait: css`
    grid-area: 1 / 2;

    @media (width <= 1100px) {
      display: none;
    }
  `,
  railSurface: css`
    transform: translateX(0);
    visibility: visible;
    opacity: 1;
    transition:
      opacity ${RAIL_TRANSITION_DURATION}ms ease-out,
      transform ${RAIL_TRANSITION_DURATION}ms ease-out,
      visibility 0s linear;

    &[data-collapsed='true'] {
      pointer-events: none;

      transform: translateX(${RAIL_EXIT_OFFSET}px);

      visibility: hidden;
      opacity: 0;

      transition-delay: 0s, 0s, ${RAIL_TRANSITION_DURATION}ms;

      &:dir(rtl) {
        transform: translateX(-${RAIL_EXIT_OFFSET}px);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }

    @media (width <= 1100px) {
      &[data-collapsed='true'] {
        display: none;
      }
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

    @media (width <= 1100px) {
      grid-area: 3 / 1;
      justify-self: end;
      width: min(100%, ${RAIL_CARD_WIDTH + RAIL_GUTTER}px);
    }
  `,
  railScroll: css`
    flex: 1;
    min-width: 0;
    min-height: 0;

    @media (width <= 1100px) {
      flex: none;
      width: 100%;
    }
  `,
}));

const Home = memo(() => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const [showHomeRail, toggleHomeRail, isStatusInit] = useGlobalStore((s) => [
    systemStatusSelectors.showHomeRail(s),
    s.toggleHomeRail,
    systemStatusSelectors.isStatusInit(s),
  ]);
  const [mode, setMode] = useState<HomeMode>('chat');
  const [inputValue, setInputValue] = useState('');
  const railVisible = Boolean(isLogin && showHomeRail);
  const railCollapsed = !railVisible;

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
    <Flexbox className={styles.grid}>
      <div className={cx(styles.header, styles.content, railCollapsed && styles.contentCentered)}>
        <HomeHeader
          railVisible={railVisible}
          onToggleRail={isStatusInit ? toggleHomeRail : undefined}
        />
      </div>

      {isLogin && (
        <div
          aria-hidden={railCollapsed}
          className={cx(styles.portrait, styles.railSurface)}
          data-collapsed={railCollapsed}
        >
          <HomePortrait />
        </div>
      )}

      <Flexbox
        className={cx(styles.main, styles.content, railCollapsed && styles.contentCentered)}
        data-testid={'home-main'}
        gap={24}
      >
        <div className={styles.inputArea}>
          {isLogin && isStatusInit && (
            <div className={styles.railToggle}>
              <RailToggle
                edge
                railVisible={railVisible}
                testId={'home-rail-toggle-desktop'}
                onToggle={toggleHomeRail}
              />
            </div>
          )}
          <InputArea
            inputValue={inputValue}
            mode={mode}
            onInputValueChange={handleInputValueChange}
            onModeChange={setMode}
          />
        </div>
        <ScrollArea
          disableContentFit
          scrollFade
          className={styles.mainScroll}
          contentProps={{ style: MAIN_CONTENT_STYLE }}
          scrollbarProps={{ className: styles.mainScrollbar }}
        >
          <HomeModeContent mode={mode} onSuggestionSelect={handleSuggestionSelect} />
        </ScrollArea>
      </Flexbox>

      {isLogin && (
        <aside
          aria-hidden={railCollapsed}
          className={cx(styles.rail, styles.railSurface)}
          data-collapsed={railCollapsed}
          data-testid={'home-rail'}
          id={'home-rail'}
          inert={railCollapsed}
        >
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
