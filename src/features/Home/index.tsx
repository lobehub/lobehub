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
import PortraitBubble from './PortraitBubble';
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
const RAIL_RECLAIMED_WIDTH = RAIL_CARD_WIDTH + RAIL_GUTTER + RAIL_COLUMN_GAP;
/** Share of the vacated rail track the content keeps; the rest is split as margin. */
const COLLAPSED_CONTENT_GAIN = 140;
const COLLAPSED_CONTENT_OFFSET = (RAIL_RECLAIMED_WIDTH - COLLAPSED_CONTENT_GAIN) / 2;
/** Portrait width plus its inline inset and the gap the bubble keeps from it. */
const PORTRAIT_LANE = 152 + 12 + 16;
const BUBBLE_MAX_WIDTH = 336;
const BUBBLE_GAP = 16;
/**
 * What the greeting must leave alone so the bubble never lands on it, measured
 * in the tighter of the two states: the collapsed content is inset by
 * COLLAPSED_CONTENT_OFFSET on both sides, and the bubble occupies the portrait's
 * lane plus its own width. Subtracted from the *container* width, because the
 * bubble tracks the container's trailing edge while the greeting starts at its
 * leading edge — a fixed measure only happens to clear it at full width.
 */
const GREETING_LANE = COLLAPSED_CONTENT_OFFSET * 2 + PORTRAIT_LANE + BUBBLE_MAX_WIDTH + BUBBLE_GAP;
/** Under this the greeting, the bubble and the portrait cannot share a line. */
const BUBBLE_INLINE_MIN = 1080;

const MAIN_CONTENT_STYLE = { ...scrollContent, paddingInline: ROW_BLEED };
const RAIL_CONTENT_STYLE = { ...scrollContent, paddingInlineEnd: RAIL_GUTTER };

const styles = createStaticStyles(({ css }) => ({
  // Row 1 (greeting + portrait) is fixed; row 2 gives each column its own
  // scroll viewport, so the rail and the task list scroll independently.
  grid: css`
    /* The nav panel takes 240–400px out of the viewport, so viewport breakpoints
       say nothing about the room this dashboard actually has. */
    container: home / inline-size;
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
    /* An explicit width is what makes the collapse animate: the stretched
       default computes to "auto", which cannot interpolate against a length,
       so the width would snap while the transform slid. */
    width: 100%;
    transition:
      transform ${RAIL_TRANSITION_DURATION}ms ease-out,
      width ${RAIL_TRANSITION_DURATION}ms ease-out;

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  // Collapsed, the content takes part of the vacated rail track and re-centers
  // on what is left, so the page reads wider without going full-bleed.
  contentCollapsed: css`
    @media (width > 1100px) {
      transform: translateX(${COLLAPSED_CONTENT_OFFSET}px);
      width: calc(100% + ${COLLAPSED_CONTENT_GAIN}px);

      &:dir(rtl) {
        transform: translateX(-${COLLAPSED_CONTENT_OFFSET}px);
      }
    }
  `,
  header: css`
    --home-greeting-measure: none;

    position: relative;
    grid-area: 1 / 1;

    @container home (width >= ${BUBBLE_INLINE_MIN}px) {
      --home-greeting-measure: calc(100cqw - ${GREETING_LANE}px);
    }
  `,
  // Parks beside the portrait when the row is wide enough for the three of them;
  // otherwise it drops below the greeting, where it is just another line and
  // needs no anchoring.
  bubbleSlot: css`
    --home-bubble-tail: none;

    margin-block-start: 16px;

    @container home (width >= ${BUBBLE_INLINE_MIN}px) {
      --home-bubble-tail: block;

      position: absolute;
      inset-block-end: 4px;

      /* Anchored to the header's trailing edge, which itself widens and slides
         on collapse — so the slot only has to make up the difference, and it
         makes it up with a transform, in step with the portrait it belongs to. */
      inset-inline-end: ${PORTRAIT_LANE - RAIL_RECLAIMED_WIDTH}px;

      display: flex;
      justify-content: flex-end;

      max-width: ${BUBBLE_MAX_WIDTH}px;
      margin-block-start: 0;

      transition: transform ${RAIL_TRANSITION_DURATION}ms ease-out;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  bubbleSlotCollapsed: css`
    @container home (width >= ${BUBBLE_INLINE_MIN}px) {
      transform: translateX(-${RAIL_RECLAIMED_WIDTH}px);

      &:dir(rtl) {
        transform: translateX(${RAIL_RECLAIMED_WIDTH}px);
      }
    }
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
    transition: transform ${RAIL_TRANSITION_DURATION}ms ease-out;

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }

    @media (width <= 1100px) {
      display: none;
    }
  `,
  // With the rail gone the agent has nothing to lean into, so it slides over the
  // composer instead of disappearing with the cards — keeping the same dip, so
  // the same half of it stays behind the surface it leans on.
  portraitCollapsed: css`
    @media (width > 1100px) {
      transform: translateX(-${COLLAPSED_CONTENT_OFFSET}px);

      &:dir(rtl) {
        transform: translateX(${COLLAPSED_CONTENT_OFFSET}px);
      }
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
  const showHomeRail = useGlobalStore(systemStatusSelectors.showHomeRail);
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
      <div className={cx(styles.header, styles.content, railCollapsed && styles.contentCollapsed)}>
        <HomeHeader />
        {/* No portrait for signed-out visitors, so no one to speak the line. */}
        {isLogin && (
          <div className={cx(styles.bubbleSlot, railCollapsed && styles.bubbleSlotCollapsed)}>
            <PortraitBubble />
          </div>
        )}
      </div>

      {isLogin && (
        <div className={cx(styles.portrait, railCollapsed && styles.portraitCollapsed)}>
          <HomePortrait />
        </div>
      )}

      <Flexbox
        className={cx(styles.main, styles.content, railCollapsed && styles.contentCollapsed)}
        data-testid={'home-main'}
        gap={24}
      >
        <div className={styles.inputArea}>
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
            <HomeInbox hideNeedsYou hideUnread variant={'rail'} />
          </ScrollArea>
        </aside>
      )}
    </Flexbox>
  );
});

export default Home;
