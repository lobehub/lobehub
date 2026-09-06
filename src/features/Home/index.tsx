'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { lazy, memo, Suspense, useCallback, useEffect, useState } from 'react';

import { useHomeUsageWidgetActive } from '@/business/client/features/HomeUsageWidget';
import { useHomePromoLine } from '@/business/client/features/useHomePromoLine';
import HomeInbox from '@/features/HomeInbox';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import { isAcceptancePortalView } from './acceptancePortalView';
import { isHomeMinimalLayout } from './CustomizeModal/config';
import HomeHeader from './HomeHeader';
import HomeModeContent from './HomeModeContent';
import HomePortrait from './HomePortrait';
import InputArea from './InputArea';
import PortraitBubble from './PortraitBubble';
import {
  HOME_PORTRAIT_INSET,
  HOME_PORTRAIT_VISIBLE_RATIO,
  HOME_PORTRAIT_WIDTH,
} from './portraitFraming';
import { RAIL_INBOX_PROPS, resolveRailVisibility } from './railVisibility';
import type { HomeMode } from './types';

export const DEFAULT_HOME_MODE: HomeMode = 'chat';
export const ONBOARDING_HOME_MODE_PARAM = 'onboarding';
export const ONBOARDING_HOME_MODE_TASK_VALUE = 'task';

export const resolveInitialHomeMode = (search: string): HomeMode => {
  const params = new URLSearchParams(search);
  return params.get(ONBOARDING_HOME_MODE_PARAM) === ONBOARDING_HOME_MODE_TASK_VALUE
    ? 'task'
    : DEFAULT_HOME_MODE;
};

const clearOnboardingHomeModeParam = () => {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  if (url.searchParams.get(ONBOARDING_HOME_MODE_PARAM) !== ONBOARDING_HOME_MODE_TASK_VALUE) return;

  url.searchParams.delete(ONBOARDING_HOME_MODE_PARAM);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
};

// The "View run" button on brief cards only writes drawer state to the task
// store — some component must mount the drawer shell that reacts to it.
// TaskDetailPage mounts its own; home needs one too, or the click is a silent
// no-op. Lazy so the home bundle doesn't pay for the chat stack until a run is
// actually opened.
const TopicChatDrawer = lazy(() => import('@/features/AgentTasks/AgentTaskDetail/TopicChatDrawer'));
const AcceptancePortalDrawer = lazy(() => import('./AcceptancePortalDrawer'));

/** Trailing gutter that keeps the rail's cards off the page's scroll lane. */
const RAIL_GUTTER = 14;
const RAIL_CARD_WIDTH = 380;
const RAIL_COLUMN_GAP = 28;
const RAIL_EXIT_OFFSET = 24;
const RAIL_TRANSITION_DURATION = 220;
const RAIL_RECLAIMED_WIDTH = RAIL_CARD_WIDTH + RAIL_GUTTER + RAIL_COLUMN_GAP;
/** Portrait width plus its inline inset and the gap it keeps from the text. */
const PORTRAIT_LANE = HOME_PORTRAIT_WIDTH + HOME_PORTRAIT_INSET + 16;
/** Reclaim the artwork's full lane so collapsing never narrows the text above. */
const COLLAPSED_CONTENT_GAIN = PORTRAIT_LANE;
const COLLAPSED_CONTENT_OFFSET = (RAIL_RECLAIMED_WIDTH - COLLAPSED_CONTENT_GAIN) / 2;
const SPEECH_BUBBLE_MIN = 320;
const SPEECH_GREETING_GAP = 24;
const SPEECH_GREETING_MIN = 320;
const SPEECH_RESERVED_WIDTH =
  COLLAPSED_CONTENT_OFFSET * 2 + SPEECH_GREETING_GAP + SPEECH_BUBBLE_MIN + PORTRAIT_LANE;
/** Use the tighter rail state so its animation cannot switch rows or rewrap text. */
const SPEECH_INLINE_MIN = SPEECH_RESERVED_WIDTH + SPEECH_GREETING_MIN;
const COMPACT_PORTRAIT_HEIGHT = 150;
const COMPACT_PORTRAIT_WIDTH = HOME_PORTRAIT_WIDTH * (COMPACT_PORTRAIT_HEIGHT / 200);
/** Include the 24px grid gap so the composer reveals the same artwork fraction. */
const COMPACT_PORTRAIT_OVERLAP = COMPACT_PORTRAIT_HEIGHT * (1 - HOME_PORTRAIT_VISIBLE_RATIO) + 24;
const MINIMAL_STACK_GAP = 24;
/**
 * The minimal header stacks the agent switcher (24px avatar + 2px paddings,
 * from AgentSelect) over the greeting line (22px × 1.4, from HomeHeader) with
 * an 8px gap. That stack's height plus the gap below it is what the block must
 * shed under itself to land the composer, not the stack's midpoint, on the
 * center of the lane.
 */
const MINIMAL_GREETING_LINE = Math.round(22 * 1.4);
const MINIMAL_SWITCHER_ROW = 28;
const MINIMAL_HEADER_GAP = 8;
const MINIMAL_HEADER_HEIGHT = MINIMAL_SWITCHER_ROW + MINIMAL_HEADER_GAP + MINIMAL_GREETING_LINE;
const MINIMAL_LIFT = MINIMAL_HEADER_HEIGHT + MINIMAL_STACK_GAP;

const styles = createStaticStyles(({ css }) => ({
  // Both rows size to their content and the page scrolls around the whole grid
  // (see the route). Giving each column its own scroll viewport made the page
  // scroll in pieces: the topic list moved under a pinned greeting while the
  // rail sat still, and no gesture moved the dashboard as a whole.
  grid: css`
    /* The nav panel takes 240–400px out of the viewport, so viewport breakpoints
       say nothing about the room this dashboard actually has. */
    container: home / inline-size;
    display: grid;
    grid-template-columns: minmax(0, 1fr) ${RAIL_CARD_WIDTH + RAIL_GUTTER}px;
    grid-template-rows: auto auto;
    gap: 24px ${RAIL_COLUMN_GAP}px;

    width: 100%;

    @media (width <= 1100px) {
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
  hero: css`
    display: grid;
    grid-area: 1 / 1 / 2 / -1;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    align-items: end;

    width: 100%;
    min-width: 0;

    transition:
      transform ${RAIL_TRANSITION_DURATION}ms ease-out,
      width ${RAIL_TRANSITION_DURATION}ms ease-out;

    @media (width > 1100px) {
      width: calc(100% - ${COLLAPSED_CONTENT_OFFSET * 2}px);
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  heroCollapsed: css`
    @media (width > 1100px) {
      transform: translateX(${COLLAPSED_CONTENT_OFFSET}px);
      width: calc(100% - ${COLLAPSED_CONTENT_OFFSET * 2}px);

      &:dir(rtl) {
        transform: translateX(-${COLLAPSED_CONTENT_OFFSET}px);
      }
    }
  `,
  heroWithSpeech: css`
    @container home (width >= ${SPEECH_INLINE_MIN}px) {
      /* Size both text columns in a stable frame; only artwork placement
         moves when the rail toggles. Short speech leaves room for the name. */
      grid-template-columns:
        minmax(0, 1fr)
        ${SPEECH_GREETING_GAP}px
        max-content;
      gap: 0;
    }
  `,
  header: css`
    min-width: 0;

    @media (width > 1100px) {
      /* Preserve the same readable measure in the stacked and portrait-off
         modes, even while the enclosing hero changes width. */
      max-width: calc(100cqw - ${RAIL_RECLAIMED_WIDTH}px);
    }
  `,
  speech: css`
    --home-portrait-width: ${COMPACT_PORTRAIT_WIDTH}px;
    --home-portrait-height: ${COMPACT_PORTRAIT_HEIGHT}px;
    --home-portrait-overlap: -${COMPACT_PORTRAIT_OVERLAP}px;

    display: flex;
    gap: 16px;
    align-items: flex-end;
    justify-self: end;

    width: max-content;
    max-width: 100%;
    min-height: ${COMPACT_PORTRAIT_HEIGHT - COMPACT_PORTRAIT_OVERLAP}px;

    transition: transform ${RAIL_TRANSITION_DURATION}ms ease-out;

    @media (width > 1100px) {
      transform: translateX(${COLLAPSED_CONTENT_OFFSET * 2}px);

      &:dir(rtl) {
        transform: translateX(-${COLLAPSED_CONTENT_OFFSET * 2}px);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }

    @container home (width >= ${SPEECH_INLINE_MIN}px) {
      --home-portrait-width: ${HOME_PORTRAIT_WIDTH}px;
      --home-portrait-height: 200px;
      --home-portrait-overlap: -94px;

      grid-area: 1 / 3;
      align-self: stretch;

      /* Use all room left by the greeting in the tighter rail state. */
      max-width: calc(
        100cqw - ${COLLAPSED_CONTENT_OFFSET * 2 + SPEECH_GREETING_MIN + SPEECH_GREETING_GAP}px
      );
      min-height: 0;
    }
  `,
  speechCollapsed: css`
    @media (width > 1100px) {
      && {
        transform: none;
      }
    }
  `,
  bubbleSlot: css`
    width: max-content;
    min-width: 0;
    max-width: 100%;
    margin-block-end: 4px;
  `,
  portrait: css`
    pointer-events: none;
    flex: none;
    align-self: stretch;
    width: calc(var(--home-portrait-width) + ${HOME_PORTRAIT_INSET}px);
  `,
  inputArea: css`
    position: relative;
    min-width: 0;
  `,
  main: css`
    position: relative;
    grid-area: 2 / 1;
    min-width: 0;
  `,
  // Nothing stacks under the composer any more, so the page stops being a
  // dashboard: greeting and composer read as one block, on a measure of their
  // own rather than the dashboard's full span.
  //
  // The route centers this block with auto margins, which would put the pair's
  // midpoint on the center and leave the composer — the thing you actually look
  // at — sitting low. The trailing pad is counted into the centered box, so it
  // lifts everything by half its height and hands the composer the center.
  minimal: css`
    width: 100%;
    max-inline-size: 760px;
    margin-inline: auto;
    padding-block-end: ${MINIMAL_LIFT}px;
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
  // The trailing gutter keeps the cards short of the column edge, so they stop
  // where the main column's rows stop instead of running to the page margin.
  rail: css`
    position: relative;
    z-index: 1;

    display: flex;
    grid-area: 2 / 2;
    flex-direction: column;

    min-width: 0;
    padding-inline-end: ${RAIL_GUTTER}px;

    @media (width <= 1100px) {
      grid-area: 3 / 1;
      justify-self: end;
      width: min(100%, ${RAIL_CARD_WIDTH + RAIL_GUTTER}px);
    }
  `,
}));

const Home = memo(() => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const showHomeRail = useGlobalStore(systemStatusSelectors.showHomeRail);
  const showHomePortrait = useGlobalStore(systemStatusSelectors.showHomePortrait);
  const hiddenWidgets = useGlobalStore(systemStatusSelectors.hiddenHomeWidgets);
  const promo = useHomePromoLine();
  const usageActive = useHomeUsageWidgetActive();
  const minimal = isHomeMinimalLayout(
    { hiddenWidgets, showPortrait: showHomePortrait },
    usageActive,
  );
  const [mode, setMode] = useState<HomeMode>(() =>
    resolveInitialHomeMode(typeof window === 'undefined' ? '' : window.location.search),
  );
  const [inputValue, setInputValue] = useState('');

  const drawerTopicId = useTaskStore(taskDetailSelectors.activeTopicDrawerTopicId);
  const portalViewType = useChatStore(chatPortalSelectors.currentViewType);
  const acceptancePortalOpen = isAcceptancePortalView(portalViewType);
  // Mount the drawer on first open and keep it mounted afterwards, so its
  // close animation can play instead of the panel vanishing with the state.
  const [drawerMounted, setDrawerMounted] = useState(false);
  if (drawerTopicId && !drawerMounted) setDrawerMounted(true);
  const [acceptanceDrawerMounted, setAcceptanceDrawerMounted] = useState(false);
  if (acceptancePortalOpen && !acceptanceDrawerMounted) setAcceptanceDrawerMounted(true);
  const railVisible = resolveRailVisibility({ hiddenWidgets, isLogin, showHomeRail, usageActive });
  const railCollapsed = !railVisible;
  const portraitVisible = Boolean(isLogin && showHomePortrait);

  useEffect(() => {
    clearOnboardingHomeModeParam();
  }, []);

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

  if (minimal)
    return (
      <Flexbox className={styles.minimal} gap={MINIMAL_STACK_GAP}>
        <HomeHeader centered />
        <div className={styles.inputArea}>
          <InputArea
            inputValue={inputValue}
            mode={mode}
            onInputValueChange={handleInputValueChange}
            onModeChange={setMode}
          />
        </div>
      </Flexbox>
    );

  return (
    <Flexbox className={styles.grid}>
      <div
        className={cx(
          styles.hero,
          portraitVisible && styles.heroWithSpeech,
          railCollapsed && styles.heroCollapsed,
        )}
      >
        <div className={styles.header}>
          <HomeHeader />
        </div>
        {portraitVisible && (
          <div className={cx(styles.speech, railCollapsed && styles.speechCollapsed)}>
            {/* Keep the agent's line and artwork together in both header layouts. */}
            <div className={styles.bubbleSlot}>
              <PortraitBubble promo={promo} />
            </div>
            <div className={styles.portrait}>
              <HomePortrait />
            </div>
          </div>
        )}
      </div>

      <Flexbox
        className={cx(styles.main, styles.content, railCollapsed && styles.contentCollapsed)}
        data-testid={'home-main'}
        gap={24}
      >
        <Flexbox className={styles.inputArea} gap={12}>
          <InputArea
            showNewModelShortcuts
            inputValue={inputValue}
            mode={mode}
            onInputValueChange={handleInputValueChange}
            onModeChange={setMode}
          />
        </Flexbox>
        <HomeModeContent
          inlineRail={railCollapsed && isLogin}
          mode={mode}
          onSuggestionSelect={handleSuggestionSelect}
        />
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
          <HomeInbox {...RAIL_INBOX_PROPS} variant={'rail'} />
        </aside>
      )}

      {/* FloatingPanel portals to the app element, so where this sits in the
          tree doesn't affect its viewport-anchored position. */}
      {drawerMounted && (
        <Suspense fallback={null}>
          <TopicChatDrawer />
        </Suspense>
      )}
      {acceptanceDrawerMounted && (
        <Suspense fallback={null}>
          <AcceptancePortalDrawer />
        </Suspense>
      )}
    </Flexbox>
  );
});

export default Home;
