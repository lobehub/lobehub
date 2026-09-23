import { Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { type ReactNode, useEffect, useState } from 'react';

const styles = createStaticStyles(({ css }) => ({
  footer: css`
    display: flex;
    flex: none;
    gap: 8px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  modes: css`
    flex: none;
    width: auto;
  `,
  note: css`
    flex: none;

    padding-block: 6px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  tab: css`
    cursor: pointer;

    flex: none;

    padding-block: 4px;
    padding-inline: 12px;
    border: none;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    background: transparent;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &[data-active='true'] {
      font-weight: 500;
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  tabs: css`
    /* The strip scrolls rather than collapsing: a long section or slide list
       stays one gesture away instead of hiding behind a dropdown. */
    scrollbar-width: none;

    overflow-x: auto;
    display: flex;
    flex: 1;
    gap: 4px;
    align-items: center;

    &::-webkit-scrollbar {
      display: none;
    }
  `,
  tabVisual: css`
    cursor: pointer;

    flex: none;

    padding: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 4px;

    background: ${cssVar.colorBgContainer};

    &:hover {
      border-color: ${cssVar.colorBorder};
    }

    &[data-active='true'] {
      border-color: ${cssVar.colorPrimary};
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBg};
    }
  `,
}));

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
      {note ? <div className={styles.note}>{note}</div> : null}
      <div className={styles.footer}>
        <div className={styles.tabs} ref={setStrip}>
          {tabs.map((tab) => (
            <button
              className={visualTabs ? styles.tabVisual : styles.tab}
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
            className={styles.modes}
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
