'use client';

import { ContextMenuTrigger, type GenericItemType } from '@lobehub/ui';
import { ScrollArea } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { XIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  tabClose: css`
    cursor: pointer;

    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 3px;

    color: inherit;

    opacity: 0.6;
    background: transparent;

    &:hover {
      opacity: 1;
      background: ${cssVar.colorFillSecondary};
    }
  `,
  tabItem: css`
    cursor: pointer;
    user-select: none;

    display: flex;
    flex-shrink: 0;
    gap: 4px;
    align-items: center;

    max-width: 160px;
    padding-block: 4px;
    padding-inline: 8px;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    transition:
      color 0.15s,
      background 0.15s;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  tabItemActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillTertiary};
  `,
  tabLabel: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const SCROLL_AREA_STYLE = {
  background: 'transparent',
  borderRadius: 0,
  flex: 1,
  minWidth: 0,
};

const SCROLL_AREA_CONTENT_STYLE = {
  alignItems: 'center',
  display: 'flex',
  flexDirection: 'row' as const,
  gap: 4,
  paddingBlock: 8,
  paddingInlineStart: 8,
  width: 'max-content',
};

const SCROLL_AREA_SCROLLBAR_STYLE = {
  margin: 0,
};

const TabStrip = memo(() => {
  const { t } = useTranslation('chat');
  const openLocalFiles = useChatStore(chatPortalSelectors.openLocalFiles);
  const activeLocalFilePath = useChatStore(chatPortalSelectors.activeLocalFilePath);
  const setActiveLocalFile = useChatStore((s) => s.setActiveLocalFile);
  const closeLocalFileTab = useChatStore((s) => s.closeLocalFileTab);
  const closeLeftLocalFileTabs = useChatStore((s) => s.closeLeftLocalFileTabs);
  const closeOtherLocalFileTabs = useChatStore((s) => s.closeOtherLocalFileTabs);
  const closeRightLocalFileTabs = useChatStore((s) => s.closeRightLocalFileTabs);

  const getContextMenuItems = useCallback(
    (filePath: string, index: number): GenericItemType[] => [
      {
        disabled: index === 0,
        key: 'closeLeft',
        label: t('workingPanel.localFile.closeLeft'),
        onClick: () => closeLeftLocalFileTabs(filePath),
      },
      {
        disabled: index === openLocalFiles.length - 1,
        key: 'closeRight',
        label: t('workingPanel.localFile.closeRight'),
        onClick: () => closeRightLocalFileTabs(filePath),
      },
      {
        disabled: openLocalFiles.length <= 1,
        key: 'closeOther',
        label: t('workingPanel.localFile.closeOther'),
        onClick: () => closeOtherLocalFileTabs(filePath),
      },
      { type: 'divider' },
      {
        key: 'close',
        label: t('workingPanel.localFile.close'),
        onClick: () => closeLocalFileTab(filePath),
      },
    ],
    [
      closeLeftLocalFileTabs,
      closeLocalFileTab,
      closeOtherLocalFileTabs,
      closeRightLocalFileTabs,
      openLocalFiles.length,
      t,
    ],
  );

  if (openLocalFiles.length === 0) return null;

  return (
    <ScrollArea
      scrollFade
      contentProps={{ style: SCROLL_AREA_CONTENT_STYLE }}
      scrollbarProps={{ orientation: 'horizontal', style: SCROLL_AREA_SCROLLBAR_STYLE }}
      style={SCROLL_AREA_STYLE}
    >
      {openLocalFiles.map(({ filePath }, index) => {
        const filename = filePath.split('/').at(-1) ?? filePath;
        const isActive = filePath === activeLocalFilePath;

        return (
          <ContextMenuTrigger items={() => getContextMenuItems(filePath, index)} key={filePath}>
            <div
              aria-selected={isActive}
              className={`${styles.tabItem} ${isActive ? styles.tabItemActive : ''}`}
              role="tab"
              tabIndex={0}
              title={filePath}
              onClick={() => setActiveLocalFile(filePath)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActiveLocalFile(filePath);
                }
              }}
            >
              <span className={styles.tabLabel}>{filename}</span>
              <button
                aria-label={`Close ${filename}`}
                className={styles.tabClose}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeLocalFileTab(filePath);
                }}
              >
                <XIcon size={12} />
              </button>
            </div>
          </ContextMenuTrigger>
        );
      })}
    </ScrollArea>
  );
});

TabStrip.displayName = 'LocalFileTabStrip';

export default TabStrip;
