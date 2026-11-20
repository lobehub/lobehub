import { EMPTY_ARRAY } from '@lobechat/const';
import type { DeviceClaudeCodeMemoryFile } from '@lobechat/types';
import { ActionIcon, Center, Empty, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BrainIcon, FileTextIcon, RefreshCwIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { SkeletonList } from '@/components/Skeleton/NavPanel/List';
import { SkillSection } from '@/features/SkillsList';
import { useChatStore } from '@/store/chat';
import { useDensityTokens } from '@/styles/density';
import { sidebarRow } from '@/styles/density.stylex';

import { groupMemoryFiles, memoryFilePortalTarget } from './memoryView';
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
  file: DeviceClaudeCodeMemoryFile;
  indexHint: string;
  onOpen: (file: DeviceClaudeCodeMemoryFile) => void;
}

const MemoryRow = memo<MemoryRowProps>(({ file, indexHint, onOpen }) => {
  const description = file.description ?? (file.isIndex ? indexHint : undefined);
  const { iconSize } = useDensityTokens();

  return (
    <button
      {...stylex.props(styles.item)}
      title={file.relativePath}
      type="button"
      onClick={() => onOpen(file)}
    >
      <span {...stylex.props(styles.itemIcon)}>
        <Icon icon={FileTextIcon} size={iconSize} />
      </span>
      <span {...stylex.props(styles.itemText)}>
        <Text ellipsis style={{ color: 'inherit', fontSize: 'inherit', lineHeight: 'inherit' }}>
          {file.isIndex ? file.relativePath : file.name}
        </Text>
        {description && (
          <Text {...stylex.props(styles.description)} ellipsis={{ rows: 2 }}>
            {description}
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
  const memoryDir = data?.memoryDir;

  const openMemory = useCallback(
    (file: DeviceClaudeCodeMemoryFile) => {
      if (memoryDir) openLocalFile(memoryFilePortalTarget(file, memoryDir, deviceId));
    },
    [deviceId, memoryDir, openLocalFile],
  );
  const refresh = useCallback(() => void mutate(), [mutate]);

  return (
    <Flexbox data-testid={'workspace-memory'} flex={1} style={{ minHeight: 0 }}>
      {/* Outside the boundary so an empty memory can still be re-read once Claude writes one. */}
      {memoryDir && (
        <Flexbox horizontal align={'center'} gap={4} {...stylex.props(styles.toolbar)}>
          <Text ellipsis {...stylex.props(styles.location)} title={memoryDir}>
            {t('workingPanel.claudeMemory.location', { path: memoryDir })}
          </Text>
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
          isEmpty={!error && files.length === 0}
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
                  file={file}
                  indexHint={t('workingPanel.claudeMemory.indexHint')}
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
