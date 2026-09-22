'use client';

import { Flexbox, Icon, TextArea } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  confirmModal,
  createModal,
  Input,
  Skeleton,
  Text,
  toast,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CornerLeftUpIcon,
  FileIcon,
  FilePlusIcon,
  FolderIcon,
  FolderPlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { sandboxWorkspaceService } from '@/services/sandboxWorkspace';
import { formatSize } from '@/utils/format';

import { describeError } from './errorMessage';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow: hidden;

    /* Fixed, so the window does not resize under the pointer as folders open.
       A browser whose height follows its contents moves the row you were about
       to click. */
    height: 420px;
    border-block: 1px solid ${cssVar.colorBorderSecondary};
  `,
  crumb: css`
    cursor: pointer;

    flex: none;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  crumbCurrent: css`
    cursor: default;
    color: ${cssVar.colorText};
  `,
  editor: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
  `,
  meta: css`
    flex: none;

    width: 92px;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    text-align: end;
  `,
  name: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: ${cssVar.fontSizeSM};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  row: css`
    cursor: default;
    user-select: none;
    padding-block: 7px;
    padding-inline: 16px;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:hover .file-row-actions {
      opacity: 1;
    }
  `,
  rowActions: css`
    flex: none;
    width: 28px;
    opacity: 0;
    transition: opacity 150ms ${cssVar.motionEaseOut};
  `,
  scroll: css`
    overflow-y: auto;
    height: 100%;
  `,
  toolbar: css`
    padding-block: 10px;
    padding-inline: 16px;
  `,
}));

/**
 * A NUL byte in what came back as text is the reliable tell that it is not.
 *
 * Built with `fromCharCode` rather than written as an escape: the formatter
 * normalizes a unicode escape in this file to the raw control character, which
 * leaves a test that looks like it compares against a space.
 */
const looksBinary = (content: string) => content.includes(String.fromCharCode(0));

/**
 * The execution plane answers 404 for a directory that is not there, and an
 * instance that has never run does not have one: the row is created in the
 * database, while the folder appears the first time a conversation works in it.
 * That is a normal state, not a failure — and writing here makes the folder,
 * because the write endpoint creates parents.
 */
const isMissingDirectory = (error: unknown) =>
  (error as { data?: { code?: string } })?.data?.code === 'NOT_FOUND';

interface InstanceFileBrowserProps {
  /** The instance's directory, relative to the workspace root. */
  root: string;
}

/**
 * The files an instance has kept, in a window of its own.
 *
 * Every path here is relative to the WORKSPACE root, which is the vocabulary the
 * execution plane speaks — an instance's directory is a prefix inside it, not a
 * separate root. Navigation therefore carries whole paths rather than composing
 * them, and the instance's own directory is simply where the walk starts and
 * the breadcrumb stops going back.
 *
 * No `topicId` is sent: there is no conversation here to borrow a warm sandbox
 * from, so the execution plane starts one to serve the call. That is the price
 * of reaching these files from a settings page, and it is why the listing is
 * fetched per directory rather than recursively up front.
 */
const InstanceFileBrowser = memo<InstanceFileBrowserProps>(({ root }) => {
  const { t } = useTranslation('setting');

  const [cwd, setCwd] = useState(root);
  const [openFile, setOpenFile] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState<'directory' | 'file' | undefined>();
  const [newName, setNewName] = useState('');

  const listing = useSWR(
    ['sandbox-instance-files', cwd],
    () => sandboxWorkspaceService.listFiles({ path: cwd }),
    {
      // Each listing is a sandbox round trip. A missing directory is an answer,
      // not a failure to retry, and refocusing the window must not re-list.
      revalidateOnFocus: false,
      shouldRetryOnError: (error) => !isMissingDirectory(error),
    },
  );

  const file = useSWR(openFile ? ['sandbox-instance-file', openFile] : null, async () => {
    const result = await sandboxWorkspaceService.readFile({ path: openFile! });
    setDraft(result.content);
    return result;
  });

  const entries = [...(listing.data?.entries ?? [])].sort((a, b) =>
    a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1,
  );

  // Only the part of the path below the instance's own directory. Above it is
  // the workspace root, which this window deliberately does not offer.
  const crumbs = cwd === root ? [] : cwd.slice(root.length + 1).split('/');

  // Takes the translated fallback rather than its key: `t` is typed against the
  // literal key union, so threading a key through a `string` parameter loses
  // exactly the check that would catch a typo in one.
  const fail = (error: unknown, fallback: string) => toast.error(describeError(error, t, fallback));

  const openDirectory = (path: string) => {
    setCwd(path);
    setOpenFile(undefined);
    setCreating(undefined);
  };

  const save = async () => {
    if (!openFile) return;
    setSaving(true);
    try {
      await sandboxWorkspaceService.writeFile({ content: draft, path: openFile });
      await file.mutate();
      toast.success(t('environments.files.saved'));
    } catch (error) {
      fail(error, t('environments.files.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    const path = `${cwd}/${name}`;
    try {
      await (creating === 'directory'
        ? sandboxWorkspaceService.createDirectory({ path })
        : sandboxWorkspaceService.writeFile({ content: '', path }));
      setCreating(undefined);
      setNewName('');
      await listing.mutate();
    } catch (error) {
      fail(error, t('environments.files.createFailed'));
    }
  };

  const remove = async (path: string, isDirectory: boolean) => {
    try {
      // A directory is removed with everything under it: the API refuses a
      // non-empty one otherwise, which would make the action fail for exactly
      // the directories someone wants gone.
      await sandboxWorkspaceService.removeFile({ path, recursive: isDirectory });
      if (openFile === path) setOpenFile(undefined);
      await listing.mutate();
    } catch (error) {
      fail(error, t('environments.files.removeFailed'));
    }
  };

  // Asked first: there is no trash here, and a folder goes with everything
  // under it, so a slip on the one icon in the row was permanent.
  const confirmRemove = (entry: { isDirectory: boolean; name: string; path: string }) =>
    confirmModal({
      content: t(
        entry.isDirectory
          ? 'environments.files.removeConfirmDirectory'
          : 'environments.files.removeConfirmFile',
      ),
      cancelText: t('cancel', { ns: 'common' }),
      okButtonProps: { danger: true },
      okText: t('environments.files.remove'),
      onOk: () => remove(entry.path, entry.isDirectory),
      title: t('environments.files.removeConfirmTitle', { name: entry.name }),
    });

  if (openFile)
    return (
      <Flexbox>
        <Flexbox horizontal align={'center'} className={styles.toolbar} gap={8}>
          <ActionIcon
            icon={ChevronLeftIcon}
            size={'small'}
            title={t('environments.files.back')}
            onClick={() => setOpenFile(undefined)}
          />
          <Text className={styles.name} title={openFile}>
            {openFile.slice(cwd.length + 1)}
          </Text>
          <Button
            disabled={file.isLoading || draft === file.data?.content}
            loading={saving}
            type={'primary'}
            onClick={save}
          >
            {t('environments.files.save')}
          </Button>
        </Flexbox>

        <Flexbox className={styles.body} padding={16}>
          {file.isLoading ? (
            <Skeleton.Text rows={8} />
          ) : file.error ? (
            <Text fontSize={12} type={'danger'}>
              {t('environments.files.unreadable')}
            </Text>
          ) : looksBinary(file.data?.content ?? '') ? (
            // Refused rather than rendered: the write path carries text only, so
            // opening this in an editor would offer a save that corrupts it.
            <Text fontSize={12} type={'secondary'}>
              {t('environments.files.binary')}
            </Text>
          ) : (
            <TextArea
              className={styles.editor}
              style={{ height: '100%', resize: 'none' }}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
        </Flexbox>
      </Flexbox>
    );

  return (
    <Flexbox>
      <Flexbox horizontal align={'center'} className={styles.toolbar} gap={8}>
        <ActionIcon
          disabled={cwd === root}
          icon={CornerLeftUpIcon}
          size={'small'}
          title={t('environments.files.up')}
          onClick={() => openDirectory(cwd.slice(0, cwd.lastIndexOf('/')))}
        />
        {/* The instance's directory is the first crumb and the floor: there is
            no crumb above it, because the workspace root holds other instances'
            work and this window is about one instance. */}
        <Flexbox horizontal align={'center'} flex={1} gap={6} style={{ minWidth: 0 }}>
          <span
            className={cwd === root ? `${styles.crumb} ${styles.crumbCurrent}` : styles.crumb}
            onClick={() => openDirectory(root)}
          >
            {root}
          </span>
          {crumbs.map((crumb, index) => {
            const path = [root, ...crumbs.slice(0, index + 1)].join('/');
            const current = index === crumbs.length - 1;

            return (
              <Flexbox horizontal align={'center'} gap={6} key={path}>
                <Icon
                  icon={ChevronRightIcon}
                  size={12}
                  style={{ color: cssVar.colorTextQuaternary }}
                />
                <span
                  className={current ? `${styles.crumb} ${styles.crumbCurrent}` : styles.crumb}
                  onClick={() => !current && openDirectory(path)}
                >
                  {crumb}
                </span>
              </Flexbox>
            );
          })}
        </Flexbox>
        <Button
          icon={<Icon icon={FilePlusIcon} />}
          size={'small'}
          onClick={() => setCreating('file')}
        >
          {t('environments.files.newFile')}
        </Button>
        <Button
          icon={<Icon icon={FolderPlusIcon} />}
          size={'small'}
          onClick={() => setCreating('directory')}
        >
          {t('environments.files.newDirectory')}
        </Button>
      </Flexbox>

      <Flexbox className={styles.body}>
        <Flexbox className={styles.scroll}>
          {creating && (
            <Flexbox horizontal align={'center'} className={styles.row} gap={8}>
              <Icon
                icon={creating === 'directory' ? FolderIcon : FileIcon}
                size={14}
                style={{ color: cssVar.colorTextTertiary, flex: 'none' }}
              />
              <Input
                autoFocus
                style={{ flex: 1, minWidth: 0 }}
                value={newName}
                placeholder={t(
                  creating === 'directory'
                    ? 'environments.files.directoryPlaceholder'
                    : 'environments.files.filePlaceholder',
                )}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void create();
                  if (event.key === 'Escape') setCreating(undefined);
                }}
              />
              <Button disabled={!newName.trim()} size={'small'} type={'primary'} onClick={create}>
                {t('environments.files.create')}
              </Button>
              <Button size={'small'} onClick={() => setCreating(undefined)}>
                {t('environments.cancel')}
              </Button>
            </Flexbox>
          )}

          {listing.isLoading ? (
            <Flexbox gap={8} padding={16}>
              <Skeleton.Text rows={5} />
            </Flexbox>
          ) : listing.error && !isMissingDirectory(listing.error) ? (
            <Flexbox padding={16}>
              <Text fontSize={12} type={'danger'}>
                {t('environments.files.listFailed')}
              </Text>
            </Flexbox>
          ) : entries.length === 0 && !creating ? (
            <Flexbox padding={16}>
              <Text fontSize={12} type={'secondary'}>
                {t(
                  listing.error && cwd === root
                    ? 'environments.files.unusedInstance'
                    : 'environments.files.empty',
                )}
              </Text>
            </Flexbox>
          ) : (
            entries.map((entry) => (
              <Flexbox
                horizontal
                align={'center'}
                className={styles.row}
                gap={8}
                key={entry.path}
                // Double-click to open, the way a file manager does. A single
                // click on a whole row is too easy to trigger while reading one.
                onDoubleClick={() =>
                  entry.isDirectory ? openDirectory(entry.path) : setOpenFile(entry.path)
                }
              >
                <Icon
                  icon={entry.isDirectory ? FolderIcon : FileIcon}
                  size={14}
                  style={{ color: cssVar.colorTextTertiary, flex: 'none' }}
                />
                <span className={styles.name}>{entry.name}</span>
                <span className={styles.meta}>
                  {entry.isDirectory || entry.size === undefined ? '' : formatSize(entry.size)}
                </span>
                <span className={styles.meta}>
                  {entry.modifiedAt ? dayjs(entry.modifiedAt).format('MM-DD HH:mm') : ''}
                </span>
                <span
                  className={`${styles.rowActions} file-row-actions`}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <ActionIcon
                    icon={Trash2Icon}
                    size={'small'}
                    title={t('environments.files.remove')}
                    onClick={() => confirmRemove(entry)}
                  />
                </span>
              </Flexbox>
            ))
          )}
        </Flexbox>
      </Flexbox>

      <Flexbox horizontal align={'center'} className={styles.toolbar}>
        <Text fontSize={12} type={'secondary'}>
          {t('environments.files.openHint')}
        </Text>
      </Flexbox>
    </Flexbox>
  );
});

InstanceFileBrowser.displayName = 'InstanceFileBrowser';

/**
 * Opened as a window rather than inside the detail panel: a file listing needs
 * width the panel does not have, and browsing an instance is its own errand —
 * it should not replace the environment you were reading in order to start it.
 */
export const openInstanceFileBrowser = (instance: { name: string; workingDirectory: string }) =>
  createModal({
    content: <InstanceFileBrowser root={instance.workingDirectory} />,
    footer: null,
    maskClosable: true,
    styles: { content: { padding: 0 } },
    title: instance.name,
    width: 'min(92vw, 880px)',
  });

export default InstanceFileBrowser;
