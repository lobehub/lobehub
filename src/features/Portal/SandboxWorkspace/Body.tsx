'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRightIcon, FileIcon, FolderIcon, LoaderCircleIcon, Trash2Icon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { sandboxWorkspaceService } from '@/services/sandboxWorkspace';
import { useChatStore } from '@/store/chat';

const styles = createStaticStyles(({ css }) => ({
  crumb: css`
    cursor: pointer;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  hint: css`
    padding-block: 24px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  row: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 8px;
    border-radius: 4px;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  size: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const formatSize = (bytes?: number) => {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const joinPath = (base: string, name: string) => (base ? `${base}/${name}` : name);

/**
 * The persistent sandbox workspace, as a directory the user can look through
 * rather than infer from what the agent says it did.
 *
 * Listing and deletion go through the workspace API, which addresses the
 * workspace root and so can reach files outside whatever subdirectory this
 * topic happens to work in. Opening a file hands off to the existing local-file
 * portal, which already knows how to render one out of a sandbox — and is given
 * an ABSOLUTE path built from the workspace's own `dir`, because that portal
 * reads through the tool chain, which resolves relative paths against the
 * session's working directory rather than the workspace root. The two agree
 * only while no subdirectory is chosen.
 */
const Body = memo(() => {
  const { t } = useTranslation('chat');
  const [path, setPath] = useState('');
  const topicId = useChatStore((s) => s.activeTopicId);
  const openLocalFile = useChatStore((s) => s.openLocalFile);

  const { data: workspace } = useSWR('sandbox-workspace-info', () =>
    sandboxWorkspaceService.getWorkspace(),
  );

  const { data, isLoading, mutate } = useSWR(
    ['sandbox-workspace-panel', path, topicId],
    () => sandboxWorkspaceService.listFiles({ path: path || undefined, topicId }),
    { revalidateOnFocus: false },
  );

  const segments = path ? path.split('/') : [];

  const handleOpen = useCallback(
    (entryPath: string) => {
      if (!workspace?.dir || !topicId) return;

      openLocalFile({
        filePath: `${workspace.dir}/${entryPath}`,
        sandboxTopicId: topicId,
        workingDirectory: workspace.dir,
      });
    },
    [openLocalFile, topicId, workspace?.dir],
  );

  const handleDelete = useCallback(
    async (entryPath: string, isDirectory: boolean) => {
      await sandboxWorkspaceService.removeFile({
        path: entryPath,
        recursive: isDirectory,
        topicId,
      });
      await mutate();
    },
    [mutate, topicId],
  );

  return (
    <Flexbox gap={8} padding={12}>
      <Flexbox horizontal align={'center'} gap={2} wrap={'wrap'}>
        <Text className={styles.crumb} onClick={() => setPath('')}>
          {t('sandboxWorkspace.root')}
        </Text>
        {segments.map((segment, index) => (
          <Flexbox horizontal align={'center'} gap={2} key={`${segment}-${index}`}>
            <Icon icon={ChevronRightIcon} size={12} />
            <Text
              className={styles.crumb}
              onClick={() => setPath(segments.slice(0, index + 1).join('/'))}
            >
              {segment}
            </Text>
          </Flexbox>
        ))}
      </Flexbox>

      {isLoading && (
        <Flexbox align={'center'} className={styles.hint}>
          <Icon spin icon={LoaderCircleIcon} size={16} />
        </Flexbox>
      )}

      {!isLoading && (data?.entries.length ?? 0) === 0 && (
        <Text className={styles.hint} type={'secondary'}>
          {t('sandboxWorkspace.emptyDirectory')}
        </Text>
      )}

      {data?.entries.map((entry) => (
        <Flexbox
          horizontal
          align={'center'}
          className={styles.row}
          key={entry.path}
          onClick={() =>
            entry.isDirectory ? setPath(joinPath(path, entry.name)) : handleOpen(entry.path)
          }
        >
          <Icon icon={entry.isDirectory ? FolderIcon : FileIcon} size={14} />
          <Text ellipsis style={{ flex: 1 }}>
            {entry.name}
          </Text>
          {!entry.isDirectory && <span className={styles.size}>{formatSize(entry.size)}</span>}
          <ActionIcon
            icon={Trash2Icon}
            size={'small'}
            title={t('sandboxWorkspace.delete')}
            onClick={(event) => {
              // The row itself navigates or opens; deleting must not do both.
              event.stopPropagation();
              void handleDelete(entry.path, entry.isDirectory);
            }}
          />
        </Flexbox>
      ))}

      {data?.truncated && (
        <Text className={styles.hint} type={'secondary'}>
          {t('sandboxWorkspace.truncated')}
        </Text>
      )}
    </Flexbox>
  );
});

Body.displayName = 'SandboxWorkspaceBody';

export default Body;
