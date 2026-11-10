import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Globe2Icon, PanelsTopLeftIcon } from 'lucide-react';
import { Activity, lazy, memo } from 'react';

import { canvasIdOfTab } from '@/store/global/initialState';

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
): SidebarTabDescriptor | undefined => {
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
    visible,
  }) => (
    <>
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
  ),
);

DynamicTabPanes.displayName = 'WorkingSidebarDynamicTabPanes';

export default DynamicTabPanes;
