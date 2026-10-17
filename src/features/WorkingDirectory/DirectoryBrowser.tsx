'use client';

import { ActionIcon, Button, cssVar, Flexbox, Icon, Input, Spin, Text } from '@lobehub/ui';
import {
  ArrowUpIcon,
  CircleAlertIcon,
  FolderPlusIcon,
  HardDriveIcon,
  HouseIcon,
  RefreshCwIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';

import type { DirectorySource } from './directorySource';
import { DriveBreadcrumb } from './DriveBreadcrumb';
import { getFolderIcon } from './folderIcons';
import { NewFolderInput } from './NewFolderInput';
import { useDirectoryBrowserState } from './useDirectoryBrowserState';

export interface DirectoryBrowserProps {
  defaultPath?: string;
  /** Above the address bar; the device wording when absent, nothing when `null`. */
  description?: ReactNode;
  error?: string;
  /** Beside the footer's buttons — what a pick carries along, such as an environment. */
  footerExtra?: ReactNode;
  loading: boolean;
  onCancel: () => void;
  /** Switch to typing a path; absent where a path cannot be typed. */
  onManual?: (path: string) => void;
  onSelect: (path: string) => void;
  source: DirectorySource;
}

/**
 * A refused pick: one plain sentence, with whatever the source said folded
 * behind a toggle — the raw reason helps a report, not the person choosing.
 */
const SubmitError = ({ detail }: { detail: string }) => {
  const { t } = useTranslation('device');
  const [expanded, setExpanded] = useState(false);

  // A new refusal starts folded again.
  useEffect(() => setExpanded(false), [detail]);

  return (
    <Flexbox gap={4} role={'alert'}>
      <Flexbox horizontal align={'center'} gap={6}>
        <Icon color={cssVar.colorError} icon={CircleAlertIcon} size={14} />
        <Text type={'danger'}>{t('workingDirectory.useFolderFailed')}</Text>
        <Button size={'small'} type={'link'} onClick={() => setExpanded((value) => !value)}>
          {t(expanded ? 'workingDirectory.errorDetailHide' : 'workingDirectory.errorDetailShow')}
        </Button>
      </Flexbox>
      {expanded && (
        <Text fontSize={12} style={{ wordBreak: 'break-word' }} type={'secondary'}>
          {detail}
        </Text>
      )}
    </Flexbox>
  );
};

/**
 * Browse folders and pick one — on a device or on the cloud sandbox's drive,
 * whichever the {@link DirectorySource} reads from. Navigation, the new-folder
 * row, and the loading, empty and error states are the same everywhere; what a
 * folder is, and what may be picked, is the source's business.
 */
export const DirectoryBrowser = ({
  defaultPath,
  description,
  error: submitError,
  footerExtra,
  loading,
  onCancel,
  onManual,
  onSelect,
  source,
}: DirectoryBrowserProps) => {
  const { t } = useTranslation('device');
  const { t: tCommon } = useTranslation('common');
  const {
    path,
    draft,
    creatingFolder,
    editPath,
    isPathConfirmed,
    navigate: setDirectoryPath,
    setCreatingFolder,
  } = useDirectoryBrowserState(defaultPath);
  const {
    directory,
    entries,
    error,
    hasMore,
    isLoading,
    isLoadingMore,
    isRefreshing,
    loadMore,
    notice,
    refresh,
    retry,
  } = source.useListing(path);
  const canUseDirectory = !isLoading && isPathConfirmed(directory?.path);
  // A browsed source (the drive) reads its place as a breadcrumb and offers a
  // new folder as a row of the list; a typed one (a device) keeps the address
  // field and its toolbar.
  const browsed = !!source.rootLabel;
  const blockedReason = directory ? source.selectBlockedReason?.(directory.path) : undefined;
  const displayedPath =
    draft ??
    (directory ? (source.displayPath?.(directory.path) ?? directory.path) : undefined) ??
    path ??
    '';

  const navigate = (nextPath?: string) => {
    setDirectoryPath(nextPath);
    if (nextPath === path) void retry();
  };

  return (
    <Flexbox gap={16}>
      {description !== null && (
        <Text type={'secondary'}>{description ?? t('workingDirectory.browseDescription')}</Text>
      )}
      {browsed ? (
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <DriveBreadcrumb
            rootIconOnly
            icon={HardDriveIcon}
            path={directory?.path ?? path ?? ''}
            rootLabel={source.rootLabel!}
            onNavigate={(next) => navigate(next || undefined)}
          />
          <ActionIcon
            aria-label={t('workingDirectory.refreshFolders')}
            disabled={loading || !directory}
            icon={RefreshCwIcon}
            loading={isRefreshing}
            size={'small'}
            title={t('workingDirectory.refreshFolders')}
            onClick={() => void refresh()}
          />
        </Flexbox>
      ) : (
        <Flexbox horizontal align={'center'} gap={8}>
          <Flexbox horizontal flex={'none'} gap={2}>
            <ActionIcon
              aria-label={t('workingDirectory.home')}
              disabled={loading}
              icon={HouseIcon}
              title={t('workingDirectory.home')}
              onClick={() => navigate()}
            />
            <ActionIcon
              aria-label={t('workingDirectory.parentFolder')}
              disabled={loading || typeof directory?.parentPath !== 'string'}
              icon={ArrowUpIcon}
              title={t('workingDirectory.parentFolder')}
              onClick={() =>
                typeof directory?.parentPath === 'string' &&
                navigate(directory.parentPath || undefined)
              }
            />
            <ActionIcon
              aria-label={t('workingDirectory.newFolder')}
              disabled={loading || !canUseDirectory || !!error}
              icon={FolderPlusIcon}
              title={t('workingDirectory.newFolder')}
              onClick={() => setCreatingFolder(true)}
            />
            <ActionIcon
              aria-label={t('workingDirectory.refreshFolders')}
              disabled={loading || !directory}
              icon={RefreshCwIcon}
              loading={isRefreshing}
              title={t('workingDirectory.refreshFolders')}
              onClick={() => void refresh()}
            />
          </Flexbox>
          <Input
            aria-label={t('workingDirectory.current')}
            disabled={loading}
            placeholder={t('workingDirectory.placeholder')}
            readOnly={!source.editablePath}
            style={{ flex: 1, minWidth: 0 }}
            value={displayedPath}
            onChange={(event) => editPath(event.target.value)}
            onPressEnter={() => navigate(displayedPath.trim() || undefined)}
          />
          {source.editablePath && (
            <Button disabled={loading} onClick={() => navigate(displayedPath.trim() || undefined)}>
              {t('workingDirectory.openPath')}
            </Button>
          )}
        </Flexbox>
      )}
      {directory?.roots && directory.roots.length > 1 && (
        <Flexbox horizontal gap={8} wrap={'wrap'}>
          {directory.roots.map((root) => (
            <Button disabled={loading} key={root} size={'small'} onClick={() => navigate(root)}>
              {root}
            </Button>
          ))}
        </Flexbox>
      )}
      <Flexbox
        aria-busy={isLoading}
        gap={4}
        key={directory?.path ?? path ?? 'home'}
        style={{ height: 'min(320px, 40vh)', overflow: 'auto' }}
      >
        {isLoading ? (
          <Flexbox align={'center'} flex={1} gap={8} justify={'center'}>
            <Spin size="small" />
            <Text type={'secondary'}>{t('workingDirectory.foldersLoading')}</Text>
          </Flexbox>
        ) : (
          <>
            {notice}
            {!browsed && creatingFolder && canUseDirectory && directory && (
              <NewFolderInput
                parentPath={directory.path}
                source={source}
                onCancel={() => setCreatingFolder(false)}
                onCreated={(createdPath) => {
                  // Refresh this listing so the new folder shows when the user
                  // steps back up, then open it so it can be used directly.
                  void retry();
                  navigate(createdPath);
                }}
              />
            )}
            {entries.map((entry) => {
              const disabled = loading || !!entry.disabled;
              const activate = () => (entry.onActivate ? entry.onActivate() : navigate(entry.path));

              return (
                <NavItem
                  actions={entry.actions}
                  aria-disabled={disabled}
                  description={entry.description}
                  disabled={disabled}
                  extra={entry.tags}
                  flex={'none'}
                  icon={entry.icon ?? getFolderIcon(entry.name)}
                  key={entry.path + entry.name}
                  role={'button'}
                  tabIndex={disabled ? -1 : 0}
                  title={entry.name}
                  titleColor={cssVar.colorText}
                  onClick={activate}
                  onKeyDown={(event) => {
                    if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault();
                      activate();
                    }
                  }}
                />
              );
            })}
            {error ? (
              <Flexbox align={'center'} gap={8} padding={16} role={'alert'}>
                <Text style={{ textAlign: 'center', whiteSpace: 'normal' }} type={'secondary'}>
                  {t(source.listErrorKey ?? 'workingDirectory.foldersLoadFailed')}
                </Text>
                <Button disabled={loading} onClick={() => void retry()}>
                  {tCommon('retry')}
                </Button>
              </Flexbox>
            ) : directory && entries.length === 0 && !creatingFolder ? (
              <Flexbox
                align={'center'}
                flex={browsed ? 'none' : 1}
                justify={'center'}
                padding={browsed ? 12 : 0}
              >
                <Text type={'secondary'}>{t('workingDirectory.foldersEmpty')}</Text>
              </Flexbox>
            ) : null}
            {browsed &&
              !error &&
              canUseDirectory &&
              directory &&
              (creatingFolder ? (
                <NewFolderInput
                  parentPath={directory.path}
                  source={source}
                  onCancel={() => setCreatingFolder(false)}
                  onCreated={(createdPath) => {
                    void retry();
                    navigate(createdPath);
                  }}
                />
              ) : (
                <NavItem
                  disabled={loading}
                  flex={'none'}
                  icon={FolderPlusIcon}
                  role={'button'}
                  tabIndex={loading ? -1 : 0}
                  title={t('workingDirectory.newFolder')}
                  titleColor={cssVar.colorTextSecondary}
                  onClick={() => setCreatingFolder(true)}
                  onKeyDown={(event) => {
                    if (!loading && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault();
                      setCreatingFolder(true);
                    }
                  }}
                />
              ))}
            {hasMore && !error && (
              <Button disabled={loading} loading={isLoadingMore} onClick={() => void loadMore()}>
                {t('workingDirectory.loadMoreFolders')}
              </Button>
            )}
          </>
        )}
      </Flexbox>
      {submitError && <SubmitError detail={submitError} />}
      {!browsed && blockedReason && canUseDirectory && (
        <Text fontSize={12} type={'warning'}>
          {blockedReason}
        </Text>
      )}
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
        {browsed ? (
          // Why the folder cannot be used, beside the button it disables.
          <Text fontSize={12} style={{ flex: 1, minWidth: 0 }} type={'secondary'}>
            {blockedReason && canUseDirectory ? blockedReason : null}
          </Text>
        ) : onManual ? (
          <Button disabled={loading} onClick={() => onManual(displayedPath)}>
            {t('workingDirectory.enterPathManually')}
          </Button>
        ) : (
          <span />
        )}
        <Flexbox horizontal align={'center'} gap={8}>
          {footerExtra}
          <Button disabled={loading} onClick={onCancel}>
            {tCommon('cancel')}
          </Button>
          <Button
            disabled={!canUseDirectory || !!blockedReason}
            loading={loading}
            type={'primary'}
            onClick={() => directory && onSelect(directory.path)}
          >
            {browsed && blockedReason && canUseDirectory
              ? t('workingDirectory.drive.pickFolderFirst')
              : t('workingDirectory.useFolder')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};
