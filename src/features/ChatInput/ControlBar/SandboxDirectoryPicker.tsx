'use client';

import { isSafeSandboxCwd } from '@lobechat/builtin-tool-cloud-sandbox';
import { Flexbox, Icon, Popover } from '@lobehub/ui';
import { Button, Input, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  LoaderCircleIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { sandboxWorkspaceService } from '@/services/sandboxWorkspace';
import { useChatStore } from '@/store/chat';

import { gitChipStyles } from './gitChipStyles';

const styles = createStaticStyles(({ css }) => ({
  crumb: css`
    cursor: pointer;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  empty: css`
    padding-block: 16px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  list: css`
    overflow-y: auto;
    max-height: 240px;
  `,
  row: css`
    cursor: pointer;

    display: flex;
    gap: 6px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 8px;
    border-radius: 4px;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

interface SandboxDirectoryPickerProps {
  /**
   * May be async: the caller has to record the choice before it can be used,
   * and that is a round trip. Errors are left to propagate, as they are for
   * folder creation below.
   */
  onChange: (path: string | undefined) => Promise<void> | void;
  /** Topic whose warm sandbox session should serve the listing. */
  topicId?: string;
  /** Currently selected directory, relative to the workspace root. */
  value?: string;
}

const joinPath = (base: string, name: string) => (base ? `${base}/${name}` : name);

/**
 * Browses the persistent workspace and writes the chosen subdirectory back to
 * the topic.
 *
 * Directories only. The workspace file panel is where files are read and
 * removed; conflating the two here would mean a click could mean "go in" or
 * "open", and the user would find out which by doing it.
 */
const SandboxDirectoryPicker = memo<SandboxDirectoryPickerProps>(({ onChange, topicId, value }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const openSandboxWorkspace = useChatStore((s) => s.openSandboxWorkspace);
  // Where the popover is browsing, which starts at the selection but moves
  // independently of it — the user is looking around, not editing yet.
  const [browsePath, setBrowsePath] = useState(value ?? '');

  const [newFolderName, setNewFolderName] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);

  const { data, isLoading, mutate } = useSWR(
    open ? ['sandbox-workspace-files', browsePath, topicId] : null,
    () => sandboxWorkspaceService.listFiles({ path: browsePath || undefined, topicId }),
    { revalidateOnFocus: false },
  );

  const directories = (data?.entries ?? []).filter((entry) => entry.isDirectory);
  const segments = browsePath ? browsePath.split('/') : [];
  // The root is always selectable; anything else has to be a directory the
  // execution plane can actually be pointed at. Refusing here means the user
  // finds out while they are choosing, not on their next message.
  const canSelectBrowsePath = !browsePath || isSafeSandboxCwd(browsePath);

  const select = (path: string | undefined) => {
    onChange(path);
    setOpen(false);
  };

  // A folder NAME, not a path: a `/` here would quietly create a nested pair
  // the user never asked for. The rest of the rule is the one the execution
  // plane enforces, applied to where the folder would actually land.
  const newFolderPath =
    newFolderName && !newFolderName.includes('/') ? joinPath(browsePath, newFolderName) : undefined;
  const canCreateFolder = Boolean(newFolderPath && isSafeSandboxCwd(newFolderPath));

  const createFolder = async () => {
    if (!newFolderPath || !canCreateFolder) return;

    setCreating(true);
    try {
      await sandboxWorkspaceService.createDirectory({ path: newFolderPath, topicId });
      setNewFolderName(undefined);
      // Step into what was just made: the reason to create a folder here is to
      // work in it, so leaving the user outside it would only mean one more click.
      setBrowsePath(newFolderPath);
      await mutate();
    } finally {
      setCreating(false);
    }
  };

  return (
    <Popover
      arrow={false}
      open={open}
      placement={'topLeft'}
      trigger={'click'}
      content={
        <Flexbox gap={8} style={{ minWidth: 260 }}>
          <Flexbox horizontal align={'center'} gap={2} wrap={'wrap'}>
            <Text className={styles.crumb} onClick={() => setBrowsePath('')}>
              {t('sandboxWorkspace.root')}
            </Text>
            {segments.map((segment, index) => (
              <Flexbox horizontal align={'center'} gap={2} key={`${segment}-${index}`}>
                <Icon icon={ChevronRightIcon} size={12} />
                <Text
                  className={styles.crumb}
                  onClick={() => setBrowsePath(segments.slice(0, index + 1).join('/'))}
                >
                  {segment}
                </Text>
              </Flexbox>
            ))}
          </Flexbox>

          <Flexbox className={styles.list}>
            {isLoading && (
              <Flexbox align={'center'} className={styles.empty}>
                <Icon spin icon={LoaderCircleIcon} size={16} />
              </Flexbox>
            )}
            {!isLoading && directories.length === 0 && (
              <Text className={styles.empty} type={'secondary'}>
                {t('sandboxWorkspace.emptyDirectory')}
              </Text>
            )}
            {directories.map((entry) => (
              <Flexbox
                horizontal
                className={styles.row}
                key={entry.path}
                onClick={() => setBrowsePath(joinPath(browsePath, entry.name))}
              >
                <Icon icon={FolderIcon} size={14} />
                <Text ellipsis>{entry.name}</Text>
              </Flexbox>
            ))}
            {data?.truncated && (
              <Text className={styles.empty} type={'secondary'}>
                {t('sandboxWorkspace.truncated')}
              </Text>
            )}
          </Flexbox>

          {newFolderName === undefined ? (
            <Flexbox horizontal className={styles.row} onClick={() => setNewFolderName('')}>
              <Icon icon={FolderPlusIcon} size={14} />
              <Text type={'secondary'}>{t('sandboxWorkspace.newFolder')}</Text>
            </Flexbox>
          ) : (
            <Flexbox horizontal align={'center'} gap={4}>
              <Input
                autoFocus
                disabled={creating}
                placeholder={t('sandboxWorkspace.newFolderPlaceholder')}
                size={'small'}
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void createFolder();
                  if (event.key === 'Escape') setNewFolderName(undefined);
                }}
              />
              <Button
                disabled={!canCreateFolder}
                loading={creating}
                size={'small'}
                type={'primary'}
                title={
                  canCreateFolder || !newFolderName
                    ? undefined
                    : t('sandboxWorkspace.unusableDirectory')
                }
                onClick={() => void createFolder()}
              >
                {t('sandboxWorkspace.create')}
              </Button>
            </Flexbox>
          )}

          <Flexbox horizontal gap={8} justify={'space-between'}>
            <Button
              size={'small'}
              type={'text'}
              onClick={() => {
                openSandboxWorkspace();
                setOpen(false);
              }}
            >
              {t('sandboxWorkspace.browseFiles')}
            </Button>
            <Flexbox horizontal gap={8}>
              {value !== undefined && (
                <Button size={'small'} type={'text'} onClick={() => select(undefined)}>
                  {t('sandboxWorkspace.useRoot')}
                </Button>
              )}
              <Button
                disabled={!canSelectBrowsePath}
                size={'small'}
                title={canSelectBrowsePath ? undefined : t('sandboxWorkspace.unusableDirectory')}
                type={'primary'}
                onClick={() => select(browsePath || undefined)}
              >
                {t('sandboxWorkspace.useThisDirectory')}
              </Button>
            </Flexbox>
          </Flexbox>
        </Flexbox>
      }
      onOpenChange={(next) => {
        setOpen(next);
        // Reopening lands back on the current selection rather than wherever
        // the last look around ended up.
        if (next) setBrowsePath(value ?? '');
      }}
    >
      <div className={gitChipStyles.prTrigger}>
        <Icon icon={FolderOpenIcon} size={14} />
        <Text ellipsis style={{ maxWidth: 160 }}>
          {value || t('sandboxWorkspace.root')}
        </Text>
      </div>
    </Popover>
  );
});

SandboxDirectoryPicker.displayName = 'SandboxDirectoryPicker';

export default SandboxDirectoryPicker;
