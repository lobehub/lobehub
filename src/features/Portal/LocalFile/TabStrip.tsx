'use client';

import { isDesktop } from '@lobechat/const';
import { confirmModal, ContextMenuTrigger, type DropdownItem, Icon, ScrollArea } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { XIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { getLocalFileTabId, isRemoteLocalFile } from '@/store/chat/slices/portal/helpers';

const SKILL_PATH_RE = /\/\.(?:agents|claude)\/skills\/([^/]+)\/SKILL\.md$/;

const resolveSkillName = (filePath: string): string | null => {
  const match = filePath.match(SKILL_PATH_RE);
  return match ? match[1] : null;
};

const styles = stylex.create({
  tabIcon: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '14px',
    height: '14px',
  },
  // The close button shows its X, or a dirty dot until hovered (it is the marker).
  tabClose: {
    cursor: 'pointer',
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '16px',
    height: '16px',
    padding: 0,
    borderStyle: 'none',
    borderRadius: '3px',
    color: 'inherit',
    opacity: { 'default': 0.6, ':hover': 1 },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillSecondary },
    backgroundImage: 'none',
  },
  closeX: { display: 'inline-flex' },
  closeXDirty: {
    display: { default: 'none', [stylex.when.ancestor(':hover')]: 'inline-flex' },
  },
  closeDot: {
    display: 'none',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorPrimary,
    backgroundImage: 'none',
  },
  closeDotDirty: {
    display: { default: 'inline-block', [stylex.when.ancestor(':hover')]: 'none' },
  },
  tabItem: {
    cursor: 'pointer',
    userSelect: 'none',
    display: 'flex',
    flexShrink: 0,
    gap: '4px',
    alignItems: 'center',
    maxWidth: '160px',
    paddingBlock: '4px',
    paddingInline: '8px',
    borderRadius: '6px',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    transition: 'color 0.15s, background 0.15s',
  },
  tabItemActive: { color: cssVar.colorText, backgroundColor: cssVar.colorFillTertiary },
  tabLabel: {
    overflow: 'hidden',
    flex: '1',
    minWidth: 0,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

const SCROLL_AREA_STYLE = {
  background: 'transparent',
  borderRadius: 0,
  // Hug the tabs so the portal header's `…` sits right after the last one;
  // still shrinks (and scrolls) once the tabs outgrow the header.
  flex: '0 1 auto',
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
    (id: string, filePath: string, perform: () => void) => {
      // Edit buffers are keyed by tab identity, not bare file path.
      if (!(id in dirtyContents)) {
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
    (id: string, filePath: string, index: number): DropdownItem[] => [
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
      // Remote device and sandbox paths cannot be revealed in the local filesystem.
      ...(isDesktop &&
      !isRemoteLocalFile(openLocalFiles.find((file) => getLocalFileTabId(file) === id))
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
          confirmClose(id, filePath, () => closeLocalFileTab(id));
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
        const dirty = id in dirtyContents;

        return (
          <ContextMenuTrigger items={() => getContextMenuItems(id, filePath, index)} key={id}>
            <div
              aria-selected={isActive}
              {...stylex.props(styles.tabItem, isActive && styles.tabItemActive)}
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
                <Icon
                  className={stylex.props(styles.tabIcon).className}
                  icon={SkillsIcon}
                  size={12}
                />
              ) : (
                <span {...stylex.props(styles.tabIcon)}>
                  <FileIcon fileName={filename} size={14} variant={'raw'} />
                </span>
              )}
              <span {...stylex.props(styles.tabLabel)}>{label}</span>
              <button
                aria-label={`Close ${filename}`}
                data-dirty={dirty ? 'true' : 'false'}
                {...stylex.props(styles.tabClose, stylex.defaultMarker())}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  confirmClose(id, filePath, () => closeLocalFileTab(id));
                }}
              >
                <span {...stylex.props(styles.closeX, dirty && styles.closeXDirty)}>
                  <XIcon size={12} />
                </span>
                <span {...stylex.props(styles.closeDot, dirty && styles.closeDotDirty)} />
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
