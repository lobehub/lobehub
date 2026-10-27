'use client';

import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import {
  ActionIcon,
  Button,
  confirmModal,
  DropdownMenu,
  Flexbox,
  Icon,
  Text,
  toast,
  Tooltip,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  FolderPlusIcon,
  HardDriveIcon,
  LockIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
  UsersIcon,
} from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { describeError } from '@/features/EnvironmentManager/errorMessage';
import {
  DriveBreadcrumb,
  driveParentPath,
  joinDrivePath,
  NewFolderInput,
  openRenameFolderModal,
} from '@/features/WorkingDirectory';
import { sandboxStorageService } from '@/services/sandboxStorage';

import {
  entryKind,
  entryModified,
  entryModifiedRelative,
  entrySize,
  sortDriveEntries,
} from './entryColumns';
import { useDriveFiles, useRefreshDrive } from './useDriveData';

/**
 * The columns after the name — size, kind, then date modified — fixed so
 * every row lines up under the header, the shape of a desktop file manager's
 * list view, and set apart by a wider gap than the icon and name so each
 * reads as its own column. The date is absolute and never wraps; its relative
 * form is the tooltip.
 */
const COLUMN_GAP = 24;
const MODIFIED_WIDTH = 136;
const SIZE_WIDTH = 80;
const KIND_WIDTH = 120;
const ACTIONS_WIDTH = 28;

const styles = stylex.create({
  clickable: {
    cursor: 'pointer',
    outline: { 'default': null, ':focus-visible': `2px solid ${cssVar.colorPrimaryBorder}` },
    outlineOffset: { 'default': null, ':focus-visible': -2 },
  },
  entryIcon: {
    color: cssVar.colorTextSecondary,
    flex: 'none',
  },
  columnLabel: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  frame: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    overflow: 'hidden',
  },
  list: {
    maxHeight: 'min(560px, 60vh)',
    minHeight: 240,
    overflowY: 'auto',
    padding: 4,
  },
  header: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    paddingBlock: 6,
    paddingInline: 16,
  },
  muted: {
    color: cssVar.colorTextTertiary,
  },
  nowrap: {
    whiteSpace: 'nowrap',
  },
  row: {
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    borderRadius: cssVar.borderRadius,
    minHeight: 40,
    paddingBlock: 4,
    paddingInline: 12,
  },
  toolbar: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    minHeight: 48,
    paddingBlock: 8,
    paddingInline: 12,
  },
});

interface DriveExplorerProps {
  drive: SandboxDrive;
  /** In a workspace, where the drives are the public one and the member's own. */
  isWorkspace: boolean;
  /** Before the toolbar's actions — a personal account's usage, which is this drive's alone. */
  toolbarExtra?: ReactNode;
}

/**
 * One drive, browsed like a desktop file manager's list view: a header, then
 * each folder and file with its icon, when it changed, its size and its kind;
 * a new folder, rename and delete.
 *
 * Every folder is an ordinary one. A folder a code environment initialized is
 * a checkout like any other — environments are one-time initializers — so
 * the only thing said about it is that it is a git repository.
 */
const DriveExplorer = memo<DriveExplorerProps>(({ drive, isWorkspace, toolbarExtra }) => {
  const { t } = useTranslation(['setting', 'device', 'common']);
  const [path, setPath] = useState('');
  const [creating, setCreating] = useState(false);
  const files = useDriveFiles(drive, path);
  const refreshDrive = useRefreshDrive();

  const tSetting = (key: string, options?: Record<string, unknown>) =>
    (t as (key: string, options?: Record<string, unknown>) => string)(key, {
      ...options,
      ns: 'setting',
    });

  const entries = sortDriveEntries(files.data?.entries ?? []);

  const failed = (error: unknown, fallback: string) =>
    toast.error(describeError(error, tSetting, fallback));

  const rename = (entry: { name: string; path: string }) =>
    openRenameFolderModal({
      currentName: entry.name,
      onSubmit: async (name) => {
        try {
          await sandboxStorageService.renameFile({
            drive,
            newPath: joinDrivePath(driveParentPath(entry.path) ?? '', name),
            path: entry.path,
          });
          await refreshDrive();
        } catch (error) {
          return describeError(
            error,
            tSetting,
            t('workingDirectory.drive.renameFailed', { ns: 'device' }),
          );
        }
      },
    });

  const remove = (entry: { isDirectory: boolean; name: string; path: string }) =>
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t(
        entry.isDirectory
          ? 'drive.explorer.deleteFolderContent'
          : 'drive.explorer.deleteFileContent',
      ),
      okButtonProps: { danger: true },
      okText: t('drive.explorer.delete'),
      onOk: async () => {
        try {
          await sandboxStorageService.removeFile({
            drive,
            path: entry.path,
            recursive: entry.isDirectory,
          });
          await refreshDrive();
        } catch (error) {
          failed(error, t('workingDirectory.drive.actionFailed', { ns: 'device' }));
        }
      },
      title: t('drive.explorer.deleteTitle', { name: entry.name }),
    });

  const scope = drive === 'public' && isWorkspace ? 'public' : 'personal';

  const menuFor = (entry: { isDirectory: boolean; name: string; path: string }) => (
    <span
      role={'none'}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <DropdownMenu
        placement={'bottomRight'}
        items={[
          ...(entry.isDirectory
            ? [
                {
                  icon: <Icon icon={PencilIcon} />,
                  key: 'rename',
                  label: t('drive.explorer.rename'),
                  onClick: () => rename(entry),
                },
              ]
            : []),
          {
            danger: true,
            icon: <Icon icon={Trash2Icon} />,
            key: 'delete',
            label: t('drive.explorer.delete'),
            onClick: () => remove(entry),
          },
        ]}
      >
        <ActionIcon
          aria-label={t('drive.explorer.moreActions')}
          icon={MoreHorizontalIcon}
          size={'small'}
        />
      </DropdownMenu>
    </span>
  );

  return (
    <Flexbox className={stylex.props(styles.frame).className}>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.toolbar).className}
        gap={12}
      >
        <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }} wrap={'wrap'}>
          <DriveBreadcrumb
            icon={HardDriveIcon}
            path={path}
            rootLabel={t(`drive.tabs.${drive}`)}
            onNavigate={setPath}
          />
          {/* Who else sees what is here: the one fact that tells the two drives apart. */}
          <Flexbox horizontal align={'center'} gap={4}>
            <Icon
              className={stylex.props(styles.muted).className}
              icon={scope === 'public' ? UsersIcon : LockIcon}
              size={12}
            />
            <Text fontSize={12} type={'secondary'}>
              {t(`drive.scope.${scope}`)}
            </Text>
          </Flexbox>
        </Flexbox>
        {toolbarExtra}
        <ActionIcon
          icon={RefreshCwIcon}
          loading={files.isValidating && !files.isLoading}
          size={'small'}
          title={t('workingDirectory.refreshFolders', { ns: 'device' })}
          onClick={() => void refreshDrive()}
        />
        <Button
          disabled={!!files.error}
          icon={<Icon icon={FolderPlusIcon} />}
          type={'primary'}
          onClick={() => setCreating(true)}
        >
          {t('drive.explorer.newFolder')}
        </Button>
      </Flexbox>

      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.header).className}
        gap={10}
      >
        <Text
          className={stylex.props(styles.columnLabel).className}
          style={{ flex: 1, paddingInlineStart: 26 }}
        >
          {t('drive.explorer.columns.name')}
        </Text>
        <Flexbox horizontal align={'center'} flex={'none'} gap={COLUMN_GAP}>
          <Text
            className={stylex.props(styles.columnLabel).className}
            style={{ flex: 'none', textAlign: 'end', width: SIZE_WIDTH }}
          >
            {t('drive.explorer.columns.size')}
          </Text>
          <Text
            className={stylex.props(styles.columnLabel).className}
            style={{ flex: 'none', width: KIND_WIDTH }}
          >
            {t('drive.explorer.columns.kind')}
          </Text>
          <Text
            className={stylex.props(styles.columnLabel).className}
            style={{ flex: 'none', width: MODIFIED_WIDTH }}
          >
            {t('drive.explorer.columns.modified')}
          </Text>
        </Flexbox>
        <span style={{ flex: 'none', width: ACTIONS_WIDTH }} />
      </Flexbox>

      <Flexbox className={stylex.props(styles.list).className} gap={2}>
        {creating && (
          <Flexbox paddingInline={6}>
            <NewFolderInput
              parentPath={path}
              source={{
                createFolder: async (parentPath, name) => {
                  const created = joinDrivePath(parentPath, name);
                  await sandboxStorageService.createDirectory({ drive, path: created });
                  return { path: created };
                },
              }}
              onCancel={() => setCreating(false)}
              onCreated={() => {
                setCreating(false);
                void refreshDrive();
              }}
            />
          </Flexbox>
        )}

        {files.isLoading ? (
          <Flexbox align={'center'} flex={1} justify={'center'} padding={24}>
            <Text type={'secondary'}>{t('workingDirectory.foldersLoading', { ns: 'device' })}</Text>
          </Flexbox>
        ) : files.error ? (
          <Flexbox align={'center'} flex={1} gap={12} justify={'center'} padding={24}>
            <Text type={'secondary'}>{t('drive.explorer.loadFailed')}</Text>
            <Button onClick={() => void files.mutate()}>{t('retry', { ns: 'common' })}</Button>
          </Flexbox>
        ) : entries.length === 0 && !creating ? (
          <Flexbox align={'center'} flex={1} gap={12} justify={'center'} padding={24}>
            <Text type={'secondary'}>
              {t(path ? 'drive.explorer.empty' : `drive.explorer.emptyRoot.${scope}`)}
            </Text>
            <Button icon={<Icon icon={FolderPlusIcon} />} onClick={() => setCreating(true)}>
              {t('drive.explorer.newFolder')}
            </Button>
          </Flexbox>
        ) : (
          entries.map((entry) => {
            const open = entry.isDirectory ? () => setPath(entry.path) : undefined;

            return (
              <Flexbox
                horizontal
                align={'center'}
                className={stylex.props(styles.row, open && styles.clickable).className}
                data-testid={'drive-entry'}
                gap={10}
                key={entry.path}
                role={open ? 'button' : undefined}
                tabIndex={open ? 0 : undefined}
                onClick={open}
                onKeyDown={
                  open
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          open();
                        }
                      }
                    : undefined
                }
              >
                <span {...stylex.props(styles.entryIcon)}>
                  <FileIcon
                    fileName={entry.isGitRepository ? '.git' : entry.name}
                    isDirectory={entry.isDirectory}
                    size={16}
                  />
                </span>
                <Text ellipsis fontSize={13} style={{ flex: 1, minWidth: 0 }}>
                  {entry.name}
                </Text>
                <Flexbox horizontal align={'center'} flex={'none'} gap={COLUMN_GAP}>
                  <Text
                    className={stylex.props(styles.nowrap).className}
                    fontSize={12}
                    style={{ flex: 'none', textAlign: 'end', width: SIZE_WIDTH }}
                    type={'secondary'}
                  >
                    {entrySize(entry)}
                  </Text>
                  <Text
                    ellipsis
                    fontSize={12}
                    style={{ flex: 'none', width: KIND_WIDTH }}
                    type={'secondary'}
                  >
                    {entryKind(entry, tSetting)}
                  </Text>
                  <Tooltip title={entryModifiedRelative(entry)}>
                    <Text
                      className={stylex.props(styles.nowrap).className}
                      fontSize={12}
                      style={{ flex: 'none', width: MODIFIED_WIDTH }}
                      type={'secondary'}
                    >
                      {entryModified(entry)}
                    </Text>
                  </Tooltip>
                </Flexbox>
                <Flexbox flex={'none'} style={{ width: ACTIONS_WIDTH }}>
                  {menuFor(entry)}
                </Flexbox>
              </Flexbox>
            );
          })
        )}
      </Flexbox>
    </Flexbox>
  );
});

DriveExplorer.displayName = 'DriveExplorer';

export default DriveExplorer;
