'use client';

import { Flexbox, Tabs, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';

import { sx } from '@/styles/sx';

import ApiList from './ApiList';
import { LIFECYCLE_MODE_LABEL, LIFECYCLE_MODES, type LifecycleMode } from './lifecycleMode';
import MessageList from './MessageList';
import moduleStyles from './ToolPage.module.css';
import ToolPreview from './ToolPreview';
import { toApiAnchor, type ToolsetEntry } from './useDevtoolsEntries';

const MODE_STORAGE_KEY = 'devtools-render-gallery:lifecycle-mode';
const VIEW_STORAGE_KEY = 'devtools-render-gallery:view';

type GalleryView = 'api' | 'aggregate';

const isLifecycleMode = (value: string | null): value is LifecycleMode =>
  !!value && (LIFECYCLE_MODES as string[]).includes(value);

const isGalleryView = (value: string | null): value is GalleryView =>
  value === 'api' || value === 'aggregate';

const styles = stylex.create({
  body: { width: '100%' },
  content: { position: 'relative', overflow: 'auto', flex: '1' },
  controlGroup: { gap: '8px', alignItems: 'center', minWidth: 0 },
  /*
   * The label sits next to a Tabs whose root is `width: 100%`, so the tabs claim the
   * whole row and the label absorbs every pixel of shrink. With the app-wide
   * `overflow-wrap: anywhere`, its min-content width is one character, so it breaks
   * mid-word ("Vie / w"). Keep the guard on the label itself, not on the row.
   */
  controlLabel: { flexShrink: 0, whiteSpace: 'nowrap' },
  controlTabs: { minWidth: 0 },
  header: {
    gap: '8px',
    padding: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  modeBar: {
    position: 'sticky',
    zIndex: 2,
    insetBlockStart: 0,
    gap: '16px',
    alignItems: 'center',
    minHeight: '44px',
    paddingBlock: '6px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

interface DevtoolsToolPageProps {
  toolset: ToolsetEntry;
}

const DevtoolsToolPage = ({ toolset }: DevtoolsToolPageProps) => {
  const [mode, setMode] = useState<LifecycleMode>('success');
  const [view, setView] = useState<GalleryView>('api');
  const [activeApi, setActiveApi] = useState<string>();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Hydrate from localStorage so the choices survive navigation between toolsets.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedMode = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (isLifecycleMode(storedMode)) setMode(storedMode);
    const storedView = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (isGalleryView(storedView)) setView(storedView);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  }, [view]);

  // Scrollspy (per-API view only): highlight the API-list item for the card the
  // reader is on — the last card whose top has crossed a trigger line just under
  // the sticky bar. A plain scroll listener (rAF-throttled) is used instead of
  // an IntersectionObserver so the boundary cases stay exact: at the very bottom
  // the last card can't reach the trigger line, and at the very top the first
  // card sits above it, so both ends are pinned explicitly.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || view !== 'api') return;

    const apiNames = toolset.apis.map((api) => api.apiName);

    // Honor a deep-link hash (#api-<name>) on load; otherwise start at the top.
    const hash = window.location.hash.replace(/^#/, '');
    const linked = apiNames.find((name) => toApiAnchor(name) === hash);
    if (linked) {
      setActiveApi(linked);
      const card = root.querySelector(`#${CSS.escape(toApiAnchor(linked))}`);
      requestAnimationFrame(() => card?.scrollIntoView({ block: 'start' }));
    } else {
      setActiveApi(apiNames[0]);
      root.scrollTo({ top: 0 });
    }

    const TRIGGER = 96; // px below the scroll-area top — clears the sticky bar
    let frame = 0;

    const compute = () => {
      frame = 0;
      if (root.scrollTop <= 0) return setActiveApi(apiNames[0]);
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2)
        return setActiveApi(apiNames.at(-1));

      const rootTop = root.getBoundingClientRect().top;
      let current = apiNames[0];
      for (const name of apiNames) {
        const el = document.getElementById(toApiAnchor(name));
        if (!el) continue;
        if (el.getBoundingClientRect().top - rootTop <= TRIGGER) current = name;
        else break;
      }
      setActiveApi(current);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(compute);
    };

    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [toolset, view]);

  const handleSelect = (apiName: string) => {
    setActiveApi(apiName);
    const root = scrollRef.current;
    const card = root?.querySelector(`#${CSS.escape(toApiAnchor(apiName))}`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Pin a shareable anchor without spamming browser history.
    window.history.replaceState(null, '', `#${toApiAnchor(apiName)}`);
  };

  return (
    <Flexbox horizontal height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
      {view === 'api' && (
        <ApiList activeApiName={activeApi} apis={toolset.apis} onSelect={handleSelect} />
      )}
      <div {...sx([styles.content], moduleStyles.content)} ref={scrollRef}>
        <Flexbox className={stylex.props(styles.body).className}>
          <Flexbox className={stylex.props(styles.header).className}>
            <Flexbox horizontal align={'center'} gap={10} wrap={'wrap'}>
              <Text fontSize={22} weight={700}>
                {toolset.toolsetName}
              </Text>
              <Tag>{toolset.identifier}</Tag>
              <Text fontSize={12} type={'secondary'}>
                {toolset.apis.length} API{toolset.apis.length === 1 ? '' : 's'}
              </Text>
            </Flexbox>
            {toolset.toolsetDescription && (
              <Text fontSize={13} type={'secondary'}>
                {toolset.toolsetDescription}
              </Text>
            )}
          </Flexbox>

          <Flexbox horizontal className={stylex.props(styles.modeBar).className} wrap={'wrap'}>
            <Flexbox horizontal className={stylex.props(styles.controlGroup).className}>
              <Text
                className={stylex.props(styles.controlLabel).className}
                fontSize={12}
                type={'secondary'}
                weight={600}
              >
                View
              </Text>
              <Tabs
                activeKey={view}
                className={sx([styles.controlTabs], moduleStyles.controlTabs).className}
                size={'small'}
                items={[
                  { key: 'api', label: 'By API' },
                  { key: 'aggregate', label: 'Aggregate' },
                ]}
                onChange={(key) => setView(key as GalleryView)}
              />
            </Flexbox>
            <Flexbox horizontal className={stylex.props(styles.controlGroup).className}>
              <Text
                className={stylex.props(styles.controlLabel).className}
                fontSize={12}
                type={'secondary'}
                weight={600}
              >
                Lifecycle
              </Text>
              <Tabs
                activeKey={mode}
                className={sx([styles.controlTabs], moduleStyles.controlTabs).className}
                size={'small'}
                items={LIFECYCLE_MODES.map((value) => ({
                  key: value,
                  label: LIFECYCLE_MODE_LABEL[value],
                }))}
                onChange={(key) => setMode(key as LifecycleMode)}
              />
            </Flexbox>
          </Flexbox>

          {view === 'api' &&
            toolset.apis.map((api) => (
              <ToolPreview api={api} key={`${api.identifier}:${api.apiName}`} mode={mode} />
            ))}
        </Flexbox>

        {view === 'aggregate' && <MessageList apis={toolset.apis} mode={mode} />}
      </div>
    </Flexbox>
  );
};

export default DevtoolsToolPage;
