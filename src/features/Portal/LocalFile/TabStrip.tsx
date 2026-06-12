'use client';

import { isDesktop } from '@lobechat/const';
import { ContextMenuTrigger, type GenericItemType, Icon } from '@lobehub/ui';
import { confirmModal, ScrollArea } from '@lobehub/ui/base-ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { createStaticStyles } from 'antd-style';
import { XIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { getLocalFileTabId } from '@/store/chat/slices/portal/helpers';

const SKILL_PATH_RE = /\/\.(?:agents|claude)\/skills\/([^/]+)\/SKILL\.md$/;

const resolveSkillName = (filePath: string): string | null => {
  const match = filePath.match(SKILL_PATH_RE);
  return match ? match[1] : null;
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  tabIcon: css`
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 14px;
    height: 14px;
  `,
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

    .cm-tab-close-x {
      display: inline-flex;
    }

    .cm-tab-close-dot {
      display: none;

      width: 8px;
      height: 8px;
      border-radius: 50%;

      background: ${cssVar.colorPrimary};
    }

    &[data-dirty='true'] {
      .cm-tab-close-x {
        display: none;
      }

      .cm-tab-close-dot {
        display: inline-block;
      }
    }

    &:hover {
      opacity: 1;
      background: ${cssVar.colorFillSecondary};

      .cm-tab-close-x {
        display: inline-flex;
      }

      .cm-tab-close-dot {
        display: none;
      }
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
  const activeLocalFileId = useChatStore(chatPortalSelectors.activeLocalFileId);
  const dirtyContents = useChatStore(chatPortalSelectors.dirtyLocalFileContents);
  const setActiveLocalFile = useChatStore((s) => s.setActiveLocalFile);
  const closeLocalFileTab = useChatStore((s) => s.closeLocalFileTab);
  const closeLeftLocalFileTabs = useChatStore((s) => s.closeLeftLocalFileTabs);
  const closeOtherLocalFileTabs = useChatStore((s) => s.closeOtherLocalFileTabs);
  const closeRightLocalFileTabs = useChatStore((s) => s.closeRightLocalFileTabs);

  const confirmClose = useCallback(
    (filePath: string, perform: () => void) => {
      if (!(filePath in dirtyContents)) {
        perform();
        return;
      }
      const filename = filePath.split('/').at(-1) ?? filePath;
      confirmModal({
        cancelText: t('cancel', { defaultValue: 'Cancel' }),
        content: t('workingPanel.localFile.closeDirty.content', {
          defaultValue: `${filename} has unsaved changes. Close without saving?`,
          filename,
        }),
        okButtonProps: { danger: true },
        okText: t('workingPanel.localFile.closeDirty.confirm', {
          defaultValue: 'Close without saving',
        }),
        onOk: perform,
        title: t('workingPanel.localFile.closeDirty.title', {
          defaultValue: 'Unsaved changes',
        }),
      });
    },
    [dirtyContents, t],
  );

  const getContextMenuItems = useCallback(
    (id: string, filePath: string, index: number): GenericItemType[] => [
      {
        disabled: index === 0,
        key: 'closeLeft',
        label: t('workingPanel.localFile.closeLeft'),
        onClick: () => closeLeftLocalFileTabs(id),
      },
      {
        disabled: index === openLocalFiles.length - 1,
        key: 'closeRight',
        label: t('workingPanel.localFile.closeRight'),
        onClick: () => closeRightLocalFileTabs(id),
      },
      {
        disabled: openLocalFiles.length <= 1,
        key: 'closeOther',
        label: t('workingPanel.localFile.closeOther'),
        onClick: () => closeOtherLocalFileTabs(id),
      },
      ...(isDesktop
        ? [
            {
              key: 'showInSystem',
              label: t('workingPanel.files.showInSystem'),
              onClick: () => void localFileService.openFileFolder(filePath),
            },
          ]
        : []),
      { type: 'divider' },
      {
        key: 'close',
        label: t('workingPanel.localFile.close'),
        onClick: () => {
          const filePath =
            openLocalFiles.find((file) => getLocalFileTabId(file) === id)?.filePath ?? id;
          confirmClose(filePath, () => closeLocalFileTab(id));
        },
      },
    ],
    [
      closeLeftLocalFileTabs,
      closeLocalFileTab,
      closeOtherLocalFileTabs,
      closeRightLocalFileTabs,
      confirmClose,
      openLocalFiles,
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
      {openLocalFiles.map((file, index) => {
        const { filePath } = file;
        const id = getLocalFileTabId(file);
        const filename = filePath.split('/').at(-1) ?? filePath;
        const skillName = resolveSkillName(filePath);
        const label = skillName ?? filename;
        const isActive = id === activeLocalFileId;

        return (
          <ContextMenuTrigger items={() => getContextMenuItems(id, filePath, index)} key={id}>
            <div
              aria-selected={isActive}
              className={`${styles.tabItem} ${isActive ? styles.tabItemActive : ''}`}
              role="tab"
              tabIndex={0}
              title={filePath}
              onClick={() => setActiveLocalFile(id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActiveLocalFile(id);
                }
              }}
            >
              {skillName ? (
                <Icon className={styles.tabIcon} icon={SkillsIcon} size={12} />
              ) : (
                <span className={styles.tabIcon}>
                  <FileIcon fileName={filename} size={14} variant={'raw'} />
                </span>
              )}
              <span className={styles.tabLabel}>{label}</span>
              <button
                aria-label={`Close ${filename}`}
                className={styles.tabClose}
                data-dirty={filePath in dirtyContents ? 'true' : 'false'}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  confirmClose(filePath, () => closeLocalFileTab(id));
                }}
              >
                <span className={'cm-tab-close-x'}>
                  <XIcon size={12} />
                </span>
                <span className={'cm-tab-close-dot'} />
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
