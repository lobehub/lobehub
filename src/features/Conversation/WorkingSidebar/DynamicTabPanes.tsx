import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Globe2Icon, PanelsTopLeftIcon } from 'lucide-react';
import { Activity, lazy, memo, useEffect } from 'react';

import { canvasIdOfTab } from '@/store/global/initialState';
import { useMcpAppStore } from '@/store/mcpApp/store';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import type { ComposerTarget } from '../types';
import CanvasPane from './Canvas/CanvasPane';
import CanvasTabLabel from './Canvas/CanvasTabLabel';
import {
  browserSessionIdOfTab,
  type BrowserTabMetadata,
  isBrowserTab,
  isCanvasTab,
  type SidebarTabDescriptor,
} from './dynamicTabs';
import { McpAppTabIcon, McpAppTabLabel } from './McpAppTabLabel';
import { McpEntryTabIcon, McpEntryTabLabel } from './McpEntryTabLabel';

const McpAppPane = lazy(() => import('./McpAppPane').then((m) => ({ default: m.McpAppPane })));
const McpEntryPane = lazy(() =>
  import('./McpEntryPane').then((m) => ({ default: m.McpEntryPane })),
);
const BrowserPane = lazy(() => import('./Browser'));

// Inline, because StyleX layout rules can lose to the `.lobe-flex` class of
// Flexbox depending on stylesheet order.
const PANE = { minHeight: 0, overflowY: 'auto' } as const;
const HIDDEN_PANE = { ...PANE, display: 'none' } as const;

const styles = stylex.create({
  favicon: {
    borderRadius: 2,
    height: 14,
    objectFit: 'contain',
    width: 14,
  },
});

export const dynamicTabDescriptor = (
  tab: string,
  browserMetadata: BrowserTabMetadata | undefined,
  browserFallbackLabel: string,
  agentId?: string,
): SidebarTabDescriptor | undefined => {
  if (tab.startsWith('mcp-entry:'))
    return {
      icon: PanelsTopLeftIcon,
      key: tab,
      iconNode: <McpEntryTabIcon agentId={agentId} tab={tab} />,
      label: <McpEntryTabLabel agentId={agentId} tab={tab} />,
    };
  if (tab.startsWith('mcp-app:'))
    return {
      icon: PanelsTopLeftIcon,
      iconNode: <McpAppTabIcon id={tab.slice(8)} />,
      key: tab,
      label: <McpAppTabLabel id={tab.slice(8)} />,
    };
  const canvasId = canvasIdOfTab(tab);
  if (canvasId) {
    return { icon: PanelsTopLeftIcon, key: tab, label: <CanvasTabLabel canvasId={canvasId} /> };
  }
  if (!isBrowserTab(tab)) return;

  return {
    icon: Globe2Icon,
    iconNode: browserMetadata?.faviconUrl ? (
      <img alt="" src={browserMetadata.faviconUrl} {...stylex.props(styles.favicon)} />
    ) : undefined,
    key: tab,
    label: browserMetadata?.title?.trim() || browserFallbackLabel,
  };
};

interface DynamicTabPanesProps {
  activeTab: string;
  agentId?: string;
  browserAvailable: boolean;
  browserSessionId: string;
  composerTarget: ComposerTarget;
  onBrowserMetadataChange: (tab: string, metadata: BrowserTabMetadata) => void;
  onCloseTab: (tab: string) => void;
  openedTabs: string[];
  visible: boolean;
}

const DynamicTabPanes = memo<DynamicTabPanesProps>(
  ({
    activeTab,
    agentId,
    browserAvailable,
    browserSessionId,
    composerTarget,
    onBrowserMetadataChange,
    openedTabs,
    onCloseTab,
    visible,
  }) => {
    const enabled = useServerConfigStore(serverConfigSelectors.enableMcpApps);
    const views = useMcpAppStore((s) => s.views);
    useEffect(() => {
      if (!enabled) return;
      for (const tab of openedTabs) {
        const view = views[tab.slice(8)];
        if (
          tab.startsWith('mcp-app:') &&
          view?.placed &&
          (view.dismissed || view.mode === 'inline')
        )
          onCloseTab(tab);
      }
    }, [views, openedTabs, onCloseTab, enabled]);
    return (
      <>
        {enabled &&
          composerTarget.writable &&
          openedTabs
            .filter((tab) => tab.startsWith('mcp-app:'))
            .map((tab) => (
              <Flexbox flex={1} key={tab} style={activeTab === tab ? PANE : HIDDEN_PANE}>
                <McpAppPane id={tab.slice(8)} scope={composerTarget.contextKey} />
              </Flexbox>
            ))}
        {enabled &&
          composerTarget.writable &&
          openedTabs
            .filter((tab) => tab.startsWith('mcp-entry:'))
            .map((tab) => (
              <Flexbox
                flex={1}
                key={`${composerTarget.contextKey}:${tab}`}
                style={activeTab === tab ? PANE : HIDDEN_PANE}
              >
                <McpEntryPane
                  agentId={agentId}
                  scope={composerTarget.contextKey}
                  tab={tab}
                  onClose={onCloseTab}
                />
              </Flexbox>
            ))}
        {browserAvailable &&
          openedTabs.filter(isBrowserTab).map((tab) => {
            const sessionId = browserSessionIdOfTab(browserSessionId, tab);

            return (
              <Flexbox flex={1} key={sessionId} style={activeTab === tab ? PANE : HIDDEN_PANE}>
                <BrowserPane
                  agentId={agentId}
                  composerTarget={composerTarget}
                  sessionId={sessionId}
                  onMetadataChange={(metadata) => onBrowserMetadataChange(tab, metadata)}
                />
              </Flexbox>
            );
          })}
        {openedTabs.filter(isCanvasTab).map((tab) => (
          <Activity key={tab} mode={visible && activeTab === tab ? 'visible' : 'hidden'}>
            <Flexbox flex={1} style={PANE}>
              <CanvasPane canvasId={canvasIdOfTab(tab)!} />
            </Flexbox>
          </Activity>
        ))}
      </>
    );
  },
);

DynamicTabPanes.displayName = 'WorkingSidebarDynamicTabPanes';

export default DynamicTabPanes;
