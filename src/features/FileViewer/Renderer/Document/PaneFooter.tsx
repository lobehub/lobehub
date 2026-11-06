import { Tabs } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode, useEffect, useState } from 'react';

const styles = stylex.create({
  footer: {
    display: 'flex',
    flex: 'none',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '6px',
    paddingInline: '8px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  modes: { flex: 'none', width: 'auto' },
  note: {
    flex: 'none',
    paddingBlock: '6px',
    paddingInline: '12px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  tab: {
    cursor: 'pointer',
    flex: 'none',
    paddingBlock: '4px',
    paddingInline: '12px',
    borderStyle: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillTertiary,
    },
    backgroundImage: 'none',
  },
  tabActive: {
    fontWeight: 500,
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillSecondary,
  },
  // The strip scrolls rather than collapsing: a long section or slide list
  // stays one gesture away instead of hiding behind a dropdown.
  tabs: {
    'scrollbarWidth': 'none',
    'overflowX': 'auto',
    'display': 'flex',
    'flex': '1',
    'gap': '4px',
    'alignItems': 'center',
    '::-webkit-scrollbar': { display: 'none' },
  },
  tabVisual: {
    cursor: 'pointer',
    flex: 'none',
    padding: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: {
      'default': cssVar.colorBorderSecondary,
      ':hover': cssVar.colorBorder,
    },
    borderRadius: '4px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  tabVisualActive: {
    borderColor: cssVar.colorPrimary,
    boxShadow: `0 0 0 2px ${cssVar.colorPrimaryBg}`,
  },
});

export interface PaneTab {
  key: string;
  label: ReactNode;
  title?: string;
}

interface PaneFooterProps {
  activeMode?: string;
  activeTab?: string;
  /** Controls placed between the tab strip and the mode switch. */
  extra?: ReactNode;
  modes?: { key: string; label: string }[];
  /** A status line above the footer — truncation, an auto-switch notice, search hits. */
  note?: ReactNode;
  onModeChange?: (key: string) => void;
  onTabChange?: (key: string) => void;
  tabs: PaneTab[];
  /** Tabs whose label is a rendered preview instead of text (slide thumbnails). */
  visualTabs?: boolean;
}

/**
 * The footer every document pane shares: navigation on the start side (sheets,
 * sections, slides), optional controls, and the view-mode switch at the end.
 */
const PaneFooter = ({
  activeMode,
  activeTab,
  extra,
  modes,
  note,
  onModeChange,
  onTabChange,
  tabs,
  visualTabs,
}: PaneFooterProps) => {
  const [strip, setStrip] = useState<HTMLElement | null>(null);

  // The strip scrolls instead of collapsing, so the active item can sit off
  // screen after a jump or after the document scrolls the selection along.
  useEffect(() => {
    if (!strip || activeTab === undefined) return;
    strip
      .querySelector(`[data-key="${CSS.escape(activeTab)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab, strip, tabs.length]);

  return (
    <>
      {note ? <div {...stylex.props(styles.note)}>{note}</div> : null}
      <div {...stylex.props(styles.footer)}>
        <div {...stylex.props(styles.tabs)} ref={setStrip}>
          {tabs.map((tab) => (
            <button
              {...stylex.props(
                visualTabs ? styles.tabVisual : styles.tab,
                tab.key === activeTab && (visualTabs ? styles.tabVisualActive : styles.tabActive),
              )}
              data-active={tab.key === activeTab}
              data-key={tab.key}
              key={tab.key}
              title={tab.title}
              type={'button'}
              onClick={() => onTabChange?.(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {extra}
        {modes && modes.length > 0 && (
          <Tabs
            activeKey={activeMode}
            className={stylex.props(styles.modes).className}
            items={modes.map((mode) => ({ key: mode.key, label: mode.label }))}
            size={'small'}
            onChange={(key) => onModeChange?.(key as string)}
          />
        )}
      </div>
    </>
  );
};

export default PaneFooter;
