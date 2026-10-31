'use client';

import { cx, Flexbox } from '@lobehub/ui';
import { lazy, memo, Suspense, useCallback, useEffect, useState } from 'react';

import { useHomeUsageWidgetActive } from '@/business/client/features/HomeUsageWidget';
import { useHomePromoLine } from '@/business/client/features/useHomePromoLine';
// Deep import, not the feature barrel: Home only needs the provider here.
import { EntityLinkHostProvider } from '@/features/EntityLink/host';
/**
 * Static on purpose: HomeModeContent already imports the inbox statically, so a
 * `lazy` wrapper saved no bytes and only suspended the rail for one frame on
 * every refresh, painting it empty before the cards arrived.
 */
import HomeInbox from '@/features/HomeInbox';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import { HOME_ENTITY_PORTAL_SCOPE, isAcceptancePortalView } from './acceptancePortalView';
import { isHomeMinimalLayout } from './CustomizeModal/config';
import HomeHeader from './HomeHeader';
import HomeModeContent from './HomeModeContent';
import HomePortrait from './HomePortrait';
import styles from './index.module.css';
import InputArea from './InputArea';
import { homeLayoutVars, MINIMAL_STACK_GAP, minimalVars } from './layoutVars';
import PortraitBubble from './PortraitBubble';
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
  /**
   * An enabled rail can settle with no cards; the main column then reclaims its
   * space without changing the preference. Only the loaded inbox may report it:
   * judging by an empty DOM node also matched while the lazy inbox was
   * suspended and while its feeds were still loading, so every refresh painted one column first and
   * slid back once the cards arrived.
   */
  const [railEmpty, setRailEmpty] = useState(false);
  const contentCollapsed = railCollapsed || (isLogin && railEmpty);
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
      <Flexbox className={styles.minimal} gap={MINIMAL_STACK_GAP} style={minimalVars}>
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
    <Flexbox className={styles.grid} style={homeLayoutVars}>
      <div
        className={cx(styles.hero, portraitVisible && styles.heroWithSpeech, styles.heroCollapsed)}
        data-rail-collapsed={contentCollapsed}
      >
        <div className={styles.header}>
          <HomeHeader />
        </div>
        {portraitVisible && (
          <div className={styles.speech} data-collapsed={contentCollapsed}>
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
        className={cx(styles.main, styles.content, styles.contentCollapsed)}
        data-rail-collapsed={contentCollapsed}
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
          className={`${styles.rail} ${styles.railSurface}`}
          data-collapsed={railCollapsed}
          data-testid={'home-rail'}
          id={'home-rail'}
          inert={railCollapsed}
        >
          {/* The inbox reads assistant replies, which carry internal entity
              links; only the acceptance drawer can show a detail here. */}
          <EntityLinkHostProvider portal={HOME_ENTITY_PORTAL_SCOPE}>
            <HomeInbox {...RAIL_INBOX_PROPS} variant={'rail'} onRailEmptyChange={setRailEmpty} />
          </EntityLinkHostProvider>
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
