'use client';

import { Flexbox, Icon, TextArea } from '@lobehub/ui';
import { ActionIcon, Button, Input, Skeleton, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ChevronLeftIcon,
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

const styles = createStaticStyles(({ css }) => ({
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

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  editor: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
  `,
  name: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  row: css`
    cursor: pointer;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:hover .file-row-actions {
      opacity: 1;
    }
  `,
  rowActions: css`
    flex: none;
    opacity: 0;
    transition: opacity 150ms ${cssVar.motionEaseOut};
  `,
  scroll: css`
    overflow-y: auto;
    max-height: 320px;
  `,
}));

/**
 * A NUL byte in what came back as text is the reliable tell that it is not.
 *
 * Built with `fromCharCode` rather than written as an escape: a literal
 * `\u0000` in this file gets normalized to the raw control character by the
 * formatter, which leaves a test that looks like it compares against a space.
 */
const looksBinary = (content: string) => content.includes(String.fromCharCode(0));

interface InstanceFileBrowserProps {
  onClose: () => void;
  /** The instance's directory, relative to the workspace root. */
  root: string;
}

/**
 * The files an instance has kept, browsable without a conversation.
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
const InstanceFileBrowser = memo<InstanceFileBrowserProps>(({ onClose, root }) => {
  const { t } = useTranslation('setting');

  const [cwd, setCwd] = useState(root);
  const [openFile, setOpenFile] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState<'directory' | 'file' | undefined>();
  const [newName, setNewName] = useState('');

  const listing = useSWR(['sandbox-instance-files', cwd], () =>
    sandboxWorkspaceService.listFiles({ path: cwd }),
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
  // the workspace root, which this browser deliberately does not offer.
  const crumbs = cwd === root ? [] : cwd.slice(root.length + 1).split('/');

  // Takes the translated fallback rather than its key: `t` is typed against the
  // literal key union, so threading a key through a `string` parameter loses
  // exactly the check that would catch a typo in one.
  const fail = (error: unknown, fallback: string) =>
    toast.error((error as { message?: string })?.message || fallback);

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

  const openDirectory = (path: string) => {
    setCwd(path);
    setOpenFile(undefined);
  };

  if (openFile)
    return (
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8}>
          <ActionIcon
            icon={ChevronLeftIcon}
            size={'small'}
            title={t('environments.files.back')}
            onClick={() => setOpenFile(undefined)}
          />
          <Text className={styles.name} title={openFile}>
            {openFile.slice(cwd.length + 1)}
          </Text>
        </Flexbox>

        {file.isLoading ? (
          <Skeleton.Text rows={6} />
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
          <>
            <TextArea
              autoSize={{ maxRows: 18, minRows: 8 }}
              className={styles.editor}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
              <Button
                disabled={draft === file.data?.content}
                loading={saving}
                size={'small'}
                type={'primary'}
                onClick={save}
              >
                {t('environments.files.save')}
              </Button>
            </Flexbox>
          </>
        )}
      </Flexbox>
    );

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} gap={8}>
        <ActionIcon
          icon={ChevronLeftIcon}
          size={'small'}
          title={t('environments.files.back')}
          onClick={onClose}
        />
        {/* The instance's directory is the first crumb and the floor: there is
            no crumb above it, because the workspace root holds other instances'
            work and this browser is about one instance. */}
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
            <Flexbox horizontal align={'center'} gap={8} key={path}>
              <Text fontSize={12} type={'secondary'}>
                /
              </Text>
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

      <Flexbox className={styles.scroll} gap={2}>
        {listing.isLoading ? (
          <Skeleton.Text rows={4} />
        ) : listing.error ? (
          <Text fontSize={12} type={'danger'}>
            {t('environments.files.listFailed')}
          </Text>
        ) : entries.length === 0 ? (
          <Text fontSize={12} type={'secondary'}>
            {t('environments.files.empty')}
          </Text>
        ) : (
          entries.map((entry) => (
            <Flexbox
              horizontal
              align={'center'}
              className={styles.row}
              gap={8}
              key={entry.path}
              onClick={() =>
                entry.isDirectory ? openDirectory(entry.path) : setOpenFile(entry.path)
              }
            >
              <Icon
                icon={entry.isDirectory ? FolderIcon : FileIcon}
                size={14}
                style={{ color: cssVar.colorTextTertiary, flex: 'none' }}
              />
              <span className={styles.name}>{entry.name}</span>
              {!entry.isDirectory && entry.size !== undefined && (
                <Text fontSize={12} type={'secondary'}>
                  {formatSize(entry.size)}
                </Text>
              )}
              <span
                className={`${styles.rowActions} file-row-actions`}
                onClick={(event) => event.stopPropagation()}
              >
                <ActionIcon
                  icon={Trash2Icon}
                  size={'small'}
                  title={t('environments.files.remove')}
                  onClick={() => remove(entry.path, entry.isDirectory)}
                />
              </span>
            </Flexbox>
          ))
        )}
        {listing.data?.truncated && (
          <Text fontSize={12} type={'secondary'}>
            {t('environments.files.truncated')}
          </Text>
        )}
      </Flexbox>

      {creating ? (
        <Flexbox horizontal align={'center'} gap={8}>
          <Input
            autoFocus
            style={{ flex: 1 }}
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
      ) : (
        <Flexbox horizontal gap={8}>
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
      )}
    </Flexbox>
  );
});

InstanceFileBrowser.displayName = 'InstanceFileBrowser';

export default InstanceFileBrowser;
