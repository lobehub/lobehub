import { EMPTY_ARRAY, isDesktop } from '@lobechat/const';
import type { DeviceClaudeCodeMemoryFile } from '@lobechat/types';
import {
  ActionIcon,
  Center,
  copyToClipboard,
  type DropdownItem,
  DropdownMenu,
  Empty,
  Flexbox,
  Icon,
  Text,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import {
  BrainIcon,
  CopyIcon,
  EllipsisIcon,
  FileTextIcon,
  FolderSearchIcon,
  RefreshCwIcon,
  TableOfContentsIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { SkeletonList } from '@/components/Skeleton/NavPanel/List';
import { SkillSection } from '@/features/SkillsList';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useDensityTokens } from '@/styles/density';
import { sidebarRow } from '@/styles/density.stylex';

import {
  findMemoryIndex,
  groupMemoryFiles,
  memoryFilePortalTarget,
  shortenMemoryDir,
} from './memoryView';
import { useClaudeCodeMemory } from './useClaudeCodeMemory';

const styles = stylex.create({
  description: {
    color: cssVar.colorTextTertiary,
    fontSize: sidebarRow.metaFontSize,
    lineHeight: '18px',
  },
  item: {
    alignItems: 'flex-start',
    backgroundColor: {
      ':focus-visible': cssVar.colorFillTertiary,
      ':hover': cssVar.colorFillTertiary,
      'default': 'transparent',
    },
    borderRadius: sidebarRow.radius,
    borderStyle: 'none',
    color: cssVar.colorText,
    cursor: 'pointer',
    display: 'flex',
    fontSize: sidebarRow.textFontSize,
    gap: sidebarRow.gap,
    lineHeight: sidebarRow.textLineHeight,
    paddingBlock: 5,
    paddingInline: sidebarRow.paddingInline,
    textAlign: 'start',
    width: '100%',
  },
  itemActive: {
    backgroundColor: { ':hover': cssVar.colorFillSecondary, 'default': cssVar.colorFillSecondary },
  },
  itemIcon: {
    alignItems: 'center',
    color: cssVar.colorTextTertiary,
    display: 'flex',
    flexShrink: 0,
    height: sidebarRow.textLineHeight,
    justifyContent: 'center',
    width: sidebarRow.iconBox,
  },
  itemText: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    minWidth: 0,
  },
  itemTitle: {
    alignItems: 'baseline',
    display: 'flex',
    gap: 8,
    minWidth: 0,
  },
  itemTime: {
    color: cssVar.colorTextQuaternary,
    flexShrink: 0,
    fontSize: sidebarRow.metaFontSize,
    whiteSpace: 'nowrap',
  },
  list: {
    minHeight: 0,
    paddingBlockEnd: sidebarRow.paneBlockEnd,
    paddingBlockStart: sidebarRow.paneBlockStart,
    paddingInline: sidebarRow.paneInline,
  },
  location: {
    color: cssVar.colorTextTertiary,
    flex: '1',
    fontSize: sidebarRow.labelFontSize,
    minWidth: 0,
  },
  toolbar: {
    flexShrink: 0,
    height: sidebarRow.toolbarHeight,
    paddingInlineEnd: sidebarRow.toolbarPaddingInlineEnd,
    paddingInlineStart: sidebarRow.toolbarPaddingInlineStart,
  },
});

interface MemoryRowProps {
  active: boolean;
  file: DeviceClaudeCodeMemoryFile;
  onOpen: (file: DeviceClaudeCodeMemoryFile) => void;
}

const MemoryRow = memo<MemoryRowProps>(({ active, file, onOpen }) => {
  const { iconSize } = useDensityTokens();

  return (
    <button
      {...stylex.props(styles.item, active && styles.itemActive)}
      aria-current={active || undefined}
      title={file.relativePath}
      type="button"
      onClick={() => onOpen(file)}
    >
      <span {...stylex.props(styles.itemIcon)}>
        <Icon icon={FileTextIcon} size={iconSize} />
      </span>
      <span {...stylex.props(styles.itemText)}>
        <span {...stylex.props(styles.itemTitle)}>
          <Text
            ellipsis
            style={{ color: 'inherit', flex: 1, fontSize: 'inherit', lineHeight: 'inherit' }}
          >
            {file.name}
          </Text>
          {file.updatedAt > 0 && (
            <time
              {...stylex.props(styles.itemTime)}
              dateTime={new Date(file.updatedAt).toISOString()}
              title={new Date(file.updatedAt).toLocaleString()}
            >
              {dayjs(file.updatedAt).fromNow()}
            </time>
          )}
        </span>
        {file.description && (
          <Text {...stylex.props(styles.description)} ellipsis={{ rows: 2 }}>
            {file.description}
          </Text>
        )}
      </span>
    </button>
  );
});

MemoryRow.displayName = 'ClaudeCodeMemoryRow';

interface MemoryPaneProps {
  /** The Claude Code agent whose own config dir, if it sets one, holds the memory. */
  agentId?: string;
  /** Bound device; the memory is then read and saved over RPC. */
  deviceId?: string;
  workingDirectory: string;
}

/**
 * Claude Code's auto memory for the selected project
 * (`~/.claude/projects/<project key>/memory`). Each file opens in the local-file
 * portal, where it can be edited and saved back in place.
 */
export const MemoryPane = memo<MemoryPaneProps>(({ agentId, deviceId, workingDirectory }) => {
  const { t } = useTranslation('chat');
  const { sectionGap } = useDensityTokens();
  const openLocalFile = useChatStore((s) => s.openLocalFile);
  const { data, error, isLoading, isValidating, mutate } = useClaudeCodeMemory({
    agentId,
    deviceId,
    workingDirectory,
  });
  const files = data?.files ?? EMPTY_ARRAY;
  const groups = useMemo(() => groupMemoryFiles(files), [files]);
  const indexFile = useMemo(() => findMemoryIndex(files), [files]);
  const memoryDir = data?.memoryDir;
  // The memory file the portal is showing, so the list keeps your place while
  // you go through memories one by one.
  const openPath = useChatStore((s) => {
    if (!chatPortalSelectors.showPortal(s) || !chatPortalSelectors.showLocalFile(s)) return;
    const current = chatPortalSelectors.currentLocalFile(s);
    return current?.deviceId === deviceId ? current?.filePath : undefined;
  });

  const openMemory = useCallback(
    (file: DeviceClaudeCodeMemoryFile) => {
      if (memoryDir) openLocalFile(memoryFilePortalTarget(file, memoryDir, deviceId));
    },
    [deviceId, memoryDir, openLocalFile],
  );
  const refresh = useCallback(() => void mutate(), [mutate]);

  const locationMenu = useMemo<DropdownItem[]>(() => {
    if (!memoryDir) return [];
    return [
      {
        icon: CopyIcon,
        key: 'copyPath',
        label: t('workingPanel.claudeMemory.copyPath'),
        onClick: async () => {
          await copyToClipboard(memoryDir);
          toast.success(t('workingPanel.claudeMemory.copyPathSuccess'));
        },
      },
      // The folder only exists once Claude has saved a memory, and only a
      // folder on this computer can be shown in the system file manager.
      ...(isDesktop && !deviceId && files.length > 0
        ? [
            {
              icon: FolderSearchIcon,
              key: 'showInSystem',
              label: t('workingPanel.files.showInSystem'),
              onClick: () =>
                void localFileService.openLocalFolder({ isDirectory: true, path: memoryDir }),
            },
          ]
        : []),
    ];
  }, [deviceId, files.length, memoryDir, t]);

  return (
    <Flexbox data-testid={'workspace-memory'} flex={1} style={{ minHeight: 0 }}>
      {/* Outside the boundary so an empty memory can still be re-read once Claude writes one. */}
      {memoryDir && (
        <Flexbox horizontal align={'center'} gap={4} {...stylex.props(styles.toolbar)}>
          <Text ellipsis {...stylex.props(styles.location)} title={memoryDir}>
            {t('workingPanel.claudeMemory.location', { path: shortenMemoryDir(memoryDir) })}
          </Text>
          {indexFile && (
            <ActionIcon
              active={openPath === indexFile.path}
              aria-label={t('workingPanel.claudeMemory.openIndex')}
              icon={TableOfContentsIcon}
              size={'small'}
              title={t('workingPanel.claudeMemory.openIndex')}
              onClick={() => openMemory(indexFile)}
            />
          )}
          <DropdownMenu items={locationMenu} placement={'bottomRight'}>
            <ActionIcon
              aria-label={t('workingPanel.claudeMemory.more')}
              icon={EllipsisIcon}
              size={'small'}
              title={t('workingPanel.claudeMemory.more')}
            />
          </DropdownMenu>
          <ActionIcon
            aria-label={t('workingPanel.claudeMemory.refresh')}
            icon={RefreshCwIcon}
            loading={isValidating}
            size={'small'}
            title={t('workingPanel.claudeMemory.refresh')}
            onClick={refresh}
          />
        </Flexbox>
      )}
      <Flexbox flex={1} gap={sectionGap} {...stylex.props(styles.list)}>
        <AsyncBoundary
          data={data}
          error={error}
          errorVariant={'inline'}
          isEmpty={!error && groups.length === 0}
          isLoading={isLoading}
          loading={<SkeletonList compact rows={4} />}
          empty={
            <Center flex={1} paddingBlock={24}>
              <Empty
                description={t('workingPanel.claudeMemory.empty.description')}
                icon={BrainIcon}
                title={t('workingPanel.claudeMemory.empty.title')}
              />
            </Center>
          }
          onRetry={refresh}
        >
          {groups.map((group) => (
            <SkillSection
              compact
              key={group.key}
              sectionHeader={{
                count: group.files.length,
                title: t(`workingPanel.claudeMemory.group.${group.key}`),
              }}
            >
              {group.files.map((file) => (
                <MemoryRow
                  active={openPath === file.path}
                  file={file}
                  key={file.path}
                  onOpen={openMemory}
                />
              ))}
            </SkillSection>
          ))}
        </AsyncBoundary>
      </Flexbox>
    </Flexbox>
  );
});

MemoryPane.displayName = 'ClaudeCodeMemoryPane';
