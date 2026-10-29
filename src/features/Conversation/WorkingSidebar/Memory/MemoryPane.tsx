import { EMPTY_ARRAY } from '@lobechat/const';
import type { DeviceClaudeCodeMemoryFile } from '@lobechat/types';
import { ActionIcon, Button, Center, Empty, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BrainIcon, FileTextIcon, RefreshCwIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import AsyncError from '@/components/AsyncError';
import { SkillSection } from '@/features/SkillsList';
import { useChatStore } from '@/store/chat';

import { groupMemoryFiles, memoryFilePortalTarget } from './memoryView';
import { useClaudeCodeMemory } from './useClaudeCodeMemory';

const styles = stylex.create({
  description: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    lineHeight: 1.5,
    paddingInlineStart: 20,
  },
  item: {
    backgroundColor: {
      ':focus-visible': cssVar.colorFillTertiary,
      ':hover': cssVar.colorFillTertiary,
      'default': 'transparent',
    },
    borderRadius: 6,
    borderStyle: 'none',
    color: {
      ':focus-visible': cssVar.colorText,
      ':hover': cssVar.colorText,
      'default': cssVar.colorTextSecondary,
    },
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    fontSize: 13,
    gap: 2,
    paddingBlock: 6,
    paddingInlineEnd: 8,
    paddingInlineStart: 4,
    textAlign: 'start',
    width: '100%',
  },
  itemIcon: {
    color: cssVar.colorTextTertiary,
    flexShrink: 0,
  },
  location: {
    flex: '1',
    fontSize: 12,
    minWidth: 0,
  },
});

interface MemoryRowProps {
  file: DeviceClaudeCodeMemoryFile;
  indexHint: string;
  onOpen: (file: DeviceClaudeCodeMemoryFile) => void;
}

const MemoryRow = memo<MemoryRowProps>(({ file, indexHint, onOpen }) => {
  const description = file.description ?? (file.isIndex ? indexHint : undefined);

  return (
    <button
      {...stylex.props(styles.item)}
      title={file.relativePath}
      type="button"
      onClick={() => onOpen(file)}
    >
      <Flexbox horizontal align={'center'} gap={6} width={'100%'}>
        <Icon {...stylex.props(styles.itemIcon)} icon={FileTextIcon} size={14} />
        <Text ellipsis style={{ color: 'inherit', flex: 1, minWidth: 0 }}>
          {file.isIndex ? file.relativePath : file.name}
        </Text>
      </Flexbox>
      {description && (
        <Text {...stylex.props(styles.description)} ellipsis={{ rows: 2 }}>
          {description}
        </Text>
      )}
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
  const openLocalFile = useChatStore((s) => s.openLocalFile);
  const { data, error, isLoading, isValidating, mutate, requiresUpgrade } = useClaudeCodeMemory({
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

  if (requiresUpgrade && data === undefined) {
    return (
      <Flexbox data-testid={'workspace-memory'} padding={12}>
        <AsyncError
          title={t('workingPanel.claudeMemory.upgrade.title')}
          action={
            <Button loading={isValidating} size={'small'} onClick={refresh}>
              {t('workingPanel.claudeMemory.upgrade.reload')}
            </Button>
          }
          description={t(
            deviceId
              ? 'workingPanel.claudeMemory.upgrade.deviceDescription'
              : 'workingPanel.claudeMemory.upgrade.desktopDescription',
          )}
        />
      </Flexbox>
    );
  }

  return (
    <Flexbox
      data-testid={'workspace-memory'}
      flex={1}
      gap={12}
      paddingBlock={8}
      paddingInline={'8px 12px'}
      style={{ minHeight: 0 }}
    >
      {/* Outside the boundary so an empty memory can still be re-read once Claude writes one. */}
      {memoryDir && (
        <Flexbox horizontal align={'center'} gap={4} paddingInline={4}>
          <Text ellipsis {...stylex.props(styles.location)} title={memoryDir} type={'secondary'}>
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
      <AsyncBoundary
        data={data}
        error={error}
        errorVariant={'inline'}
        isEmpty={!error && files.length === 0}
        isLoading={isLoading}
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
  );
});

MemoryPane.displayName = 'ClaudeCodeMemoryPane';
