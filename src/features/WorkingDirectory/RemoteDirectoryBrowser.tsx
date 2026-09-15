'use client';

import { Flexbox, Input } from '@lobehub/ui';
import { ActionIcon, Button, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { ArrowUpIcon, FolderIcon, HouseIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useFetchDeviceDirectory } from '@/store/device/directoryHooks';

interface RemoteDirectoryBrowserProps {
  defaultPath?: string;
  deviceId: string;
  error?: string;
  loading: boolean;
  onCancel: () => void;
  onManual: (path: string) => void;
  onSelect: (path: string) => void;
}

export const RemoteDirectoryBrowser = ({
  defaultPath,
  deviceId,
  error: submitError,
  loading,
  onCancel,
  onManual,
  onSelect,
}: RemoteDirectoryBrowserProps) => {
  const { t } = useTranslation('device');
  const { t: tCommon } = useTranslation('common');
  const [path, setPath] = useState(defaultPath);
  const [draft, setDraft] = useState<string>();
  const { directory, entries, error, hasMore, isLoading, isLoadingMore, loadMore, retry } =
    useFetchDeviceDirectory(deviceId, path);
  const displayedPath = draft ?? directory?.path ?? path ?? '';

  const navigate = (nextPath?: string) => {
    setDraft(undefined);
    if (nextPath === path) void retry();
    else setPath(nextPath);
  };

  return (
    <Flexbox gap={16}>
      <Text type={'secondary'}>{t('workingDirectory.browseDescription')}</Text>
      <Flexbox horizontal align={'center'} gap={8}>
        <ActionIcon
          aria-label={t('workingDirectory.home')}
          disabled={loading}
          icon={HouseIcon}
          title={t('workingDirectory.home')}
          onClick={() => navigate()}
        />
        <ActionIcon
          aria-label={t('workingDirectory.parentFolder')}
          disabled={loading || !directory?.parentPath}
          icon={ArrowUpIcon}
          title={t('workingDirectory.parentFolder')}
          onClick={() => directory?.parentPath && navigate(directory.parentPath)}
        />
        <Input
          aria-label={t('workingDirectory.current')}
          disabled={loading}
          placeholder={t('workingDirectory.placeholder')}
          style={{ flex: 1, minWidth: 0 }}
          value={displayedPath}
          onChange={(event) => setDraft(event.target.value)}
          onPressEnter={() => navigate(displayedPath.trim() || undefined)}
        />
        <Button disabled={loading} onClick={() => navigate(displayedPath.trim() || undefined)}>
          {t('workingDirectory.openPath')}
        </Button>
      </Flexbox>
      {directory && directory.roots.length > 1 && (
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
            <NeuralNetworkLoading />
            <Text type={'secondary'}>{t('workingDirectory.foldersLoading')}</Text>
          </Flexbox>
        ) : (
          <>
            {entries.map((entry) => (
              <NavItem
                aria-disabled={loading || !entry.readable}
                disabled={loading || !entry.readable}
                flex={'none'}
                icon={FolderIcon}
                key={entry.path + entry.name}
                role={'button'}
                tabIndex={loading || !entry.readable ? -1 : 0}
                title={entry.name}
                titleColor={cssVar.colorText}
                description={
                  entry.readable ? undefined : (
                    <Text type={'secondary'}>{t('workingDirectory.folderUnreadable')}</Text>
                  )
                }
                onClick={() => navigate(entry.path)}
                onKeyDown={(event) => {
                  if (!loading && entry.readable && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    navigate(entry.path);
                  }
                }}
              />
            ))}
            {error ? (
              <Flexbox align={'center'} gap={8} padding={16} role={'alert'}>
                <Text style={{ textAlign: 'center', whiteSpace: 'normal' }} type={'secondary'}>
                  {t('workingDirectory.foldersLoadFailed')}
                </Text>
                <Button disabled={loading} onClick={() => void retry()}>
                  {tCommon('retry')}
                </Button>
              </Flexbox>
            ) : directory && entries.length === 0 ? (
              <Flexbox align={'center'} flex={1} justify={'center'}>
                <Text type={'secondary'}>{t('workingDirectory.foldersEmpty')}</Text>
              </Flexbox>
            ) : null}
            {hasMore && !error && (
              <Button disabled={loading} loading={isLoadingMore} onClick={() => void loadMore()}>
                {t('workingDirectory.loadMoreFolders')}
              </Button>
            )}
          </>
        )}
      </Flexbox>
      {submitError && (
        <Text role={'alert'} type={'danger'}>
          {submitError}
        </Text>
      )}
      <Flexbox horizontal gap={8} justify={'space-between'} wrap={'wrap'}>
        <Button disabled={loading} onClick={() => onManual(displayedPath)}>
          {t('workingDirectory.enterPathManually')}
        </Button>
        <Flexbox horizontal gap={8}>
          <Button disabled={loading} onClick={onCancel}>
            {tCommon('cancel')}
          </Button>
          <Button
            loading={loading}
            type={'primary'}
            disabled={
              !directory || isLoading || (draft !== undefined && draft.trim() !== directory.path)
            }
            onClick={() => directory && onSelect(directory.path)}
          >
            {t('workingDirectory.useFolder')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};
