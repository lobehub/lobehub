'use client';

import type {
  DeviceListDirEntry,
  DeviceListDirErrorCode,
  DeviceListDirSuccessResult,
  DevicePathStyle,
  DeviceScope,
} from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  createModal,
  type ModalInstance,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Command } from 'cmdk';
import {
  FolderIcon,
  FolderSymlinkIcon,
  HomeIcon,
  RefreshCwIcon,
  ServerIcon,
  Undo2Icon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { deviceService } from '@/services/device';

import {
  createRemoteDirectoryQuery,
  ensureRemotePathTrailingSeparator,
  filterRemoteDirectoryEntries,
  inferRemotePathStyle,
  isSameRemotePath,
  splitRemotePathQuery,
} from './remotePath';
import {
  type RemoteFolderSelectionError,
  type RemoteWorkingDirectorySelection,
  useRemoteFolderSelection,
} from './useRemoteFolderSelection';

export type { RemoteWorkingDirectorySelection } from './useRemoteFolderSelection';

const DIRECTORY_LOAD_DELAY = 180;

const styles = createStaticStyles(({ css }) => ({
  command: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-height: min(520px, 68vh);

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgElevated};

    [cmdk-list] {
      overflow-y: auto;
      flex: 1;

      min-height: 280px;
      max-height: min(440px, 58vh);
      padding: 8px;
    }

    [cmdk-item] {
      cursor: pointer;
      user-select: none;

      display: flex;
      gap: 10px;
      align-items: center;

      min-height: 40px;
      padding-block: 8px;
      padding-inline: 10px;
      border-radius: ${cssVar.borderRadius};

      font-size: 14px;
      color: ${cssVar.colorText};

      &[aria-selected='true'] {
        background: ${cssVar.colorFillTertiary};
      }

      &[data-disabled='true'] {
        cursor: default;
        color: ${cssVar.colorTextSecondary};
      }
    }
  `,
  deviceLabel: css`
    font-size: 11px;
    line-height: 1.2;
    color: ${cssVar.colorTextTertiary};
  `,
  deviceName: css`
    overflow: hidden;

    font-size: 13px;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  deviceRow: css`
    padding-block: 9px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorSplit};
  `,
  empty: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    justify-content: center;

    min-height: 260px;
    padding: 32px;

    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  footerActions: css`
    flex: none;
  `,
  footer: css`
    gap: 12px;

    min-height: 58px;
    padding-block: 10px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorSplit};

    font-size: 11px;
    color: ${cssVar.colorTextDescription};
  `,
  footerHint: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  itemIcon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 18px;

    color: ${cssVar.colorTextSecondary};
  `,
  itemName: css`
    overflow: hidden;
    flex: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  pathInput: css`
    flex: 1;

    min-width: 0;
    padding: 0;
    border: none;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 17px;
    line-height: 32px;
    color: ${cssVar.colorText};

    background: transparent;
    outline: none;

    &::placeholder {
      color: ${cssVar.colorTextPlaceholder};
    }
  `,
  pathSection: css`
    padding-block: 9px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorSplit};
  `,
  pathRow: css`
    min-height: 40px;
    padding-block: 4px;
    padding-inline: 8px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillQuaternary};
  `,
  pathRowError: css`
    border-color: ${cssVar.colorError};
  `,
  sectionLabel: css`
    font-size: 11px;
    line-height: 1.2;
    color: ${cssVar.colorTextTertiary};
  `,
  symlink: css`
    flex: none;
    font-size: 11px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

interface RemoteFolderPickerContentProps {
  deviceId: string;
  deviceName: string;
  initialPath?: string;
  onSelect: (entry: RemoteWorkingDirectorySelection) => Promise<void> | void;
  scope: DeviceScope;
}

type PickerError = DeviceListDirErrorCode | RemoteFolderSelectionError;

const RemoteFolderPickerContent = ({
  deviceId,
  deviceName,
  initialPath,
  onSelect,
  scope,
}: RemoteFolderPickerContentProps) => {
  const { t } = useTranslation('device');
  const { t: tCommon } = useTranslation('common');
  const { close, setCanDismissByClickOutside } = useModalContext();
  const {
    clearError: clearSelectionError,
    confirmPath,
    error: selectionError,
    retrySave,
    selecting,
  } = useRemoteFolderSelection({ deviceId, onClose: close, onSelect, scope });
  const initialPathRef = useRef(initialPath?.trim() || undefined);
  const requestVersionRef = useRef(0);
  const [listing, setListing] = useState<DeviceListDirSuccessResult>();
  const [pathStyle, setPathStyle] = useState<DevicePathStyle>(() =>
    inferRemotePathStyle(initialPath ?? ''),
  );
  const [home, setHome] = useState('');
  const [query, setQuery] = useState(() => createRemoteDirectoryQuery(initialPath));
  const [requestedPath, setRequestedPath] = useState<string>();
  const [selectedValue, setSelectedValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<DeviceListDirErrorCode>();

  const loadDirectory = useCallback(
    async (path?: string, syncQuery = false) => {
      const requestVersion = ++requestVersionRef.current;
      setRequestedPath(path);
      setLoading(true);
      setListError(undefined);
      clearSelectionError();

      let result;
      try {
        result = await deviceService.listDir(deviceId, scope, path);
      } catch {
        if (requestVersion !== requestVersionRef.current) return;
        setListing(undefined);
        setLoading(false);
        setListError('UNAVAILABLE');
        return;
      }
      if (requestVersion !== requestVersionRef.current) return;

      setLoading(false);
      setPathStyle(result.pathStyle);
      if (result.home) setHome(result.home);
      if (syncQuery && result.path) {
        setQuery(ensureRemotePathTrailingSeparator(result.path, result.pathStyle));
      }

      if (!result.success) {
        setListing(undefined);
        setListError(result.code);
        return;
      }

      setListing(result);
      if (!syncQuery && path) {
        // The device expands `~` and relative paths against its own home. Once
        // that prefix resolves, replace only the matching prefix and preserve
        // the still-editable fuzzy suffix.
        setQuery((current) => {
          const currentParts = splitRemotePathQuery(current, result.pathStyle);
          if (!isSameRemotePath(currentParts.directory, path, result.pathStyle)) return current;
          return `${ensureRemotePathTrailingSeparator(result.path, result.pathStyle)}${currentParts.suffix}`;
        });
      }
    },
    [clearSelectionError, deviceId, scope],
  );

  useEffect(() => {
    void loadDirectory(initialPathRef.current, true);
    return () => {
      requestVersionRef.current += 1;
    };
  }, [loadDirectory]);

  useEffect(() => {
    setCanDismissByClickOutside(!selecting);
  }, [selecting, setCanDismissByClickOutside]);

  const queryParts = useMemo(() => splitRemotePathQuery(query, pathStyle), [pathStyle, query]);
  const queryDirectory = queryParts.directory ?? listing?.path;
  const listingMatchesQuery =
    !!listing &&
    (!queryParts.directory || isSameRemotePath(queryParts.directory, listing.path, pathStyle));

  useEffect(() => {
    if (selecting || selectionError) return;

    const target = queryParts.directory;
    if (!target || isSameRemotePath(target, listing?.path, pathStyle)) return;
    if (isSameRemotePath(target, requestedPath, pathStyle)) return;

    const timer = window.setTimeout(() => void loadDirectory(target), DIRECTORY_LOAD_DELAY);
    return () => window.clearTimeout(timer);
  }, [
    listing?.path,
    loadDirectory,
    pathStyle,
    queryParts.directory,
    requestedPath,
    selecting,
    selectionError,
  ]);

  const entries = useMemo(
    () =>
      listingMatchesQuery && listing
        ? filterRemoteDirectoryEntries(listing.entries, queryParts.suffix)
        : [],
    [listing, listingMatchesQuery, queryParts.suffix],
  );

  useEffect(() => {
    setSelectedValue(entries[0]?.path ?? '');
  }, [entries]);

  const navigate = useCallback(
    (path: string) => {
      setSelectedValue('');
      setQuery(ensureRemotePathTrailingSeparator(path, pathStyle));
      void loadDirectory(path, true);
    },
    [loadDirectory, pathStyle],
  );

  const error: PickerError | undefined = selectionError ?? listError;
  const selectedEntry = entries.find((entry) => entry.path === selectedValue);
  const canSelectCurrentDirectory =
    !!listing && listingMatchesQuery && !queryParts.suffix && !loading && !selecting && !error;
  const retryPath = queryParts.directory ?? requestedPath;
  const errorMessage = error
    ? {
        NOT_DIRECTORY: t('workingDirectory.browseErrorNotDirectory'),
        NOT_FOUND: t('workingDirectory.browseErrorNotFound'),
        PATH_NOT_DIRECTORY: t('workingDirectory.pathNotDirectory'),
        PATH_NOT_FOUND: t('workingDirectory.pathNotExist'),
        PERMISSION_DENIED: t('workingDirectory.browseErrorPermission'),
        SAVE_FAILED: t('workingDirectory.browseErrorSaveFailed'),
        UNAVAILABLE: t('workingDirectory.browseErrorUnavailable'),
        UNKNOWN: t('workingDirectory.browseErrorUnknown'),
      }[error]
    : undefined;

  const renderEntry = (entry: DeviceListDirEntry) => {
    const EntryIcon = entry.isSymlink ? FolderSymlinkIcon : FolderIcon;

    return (
      <Command.Item
        disabled={selecting}
        key={entry.path}
        value={entry.path}
        onSelect={() => navigate(entry.path)}
      >
        <span className={styles.itemIcon}>
          <Icon icon={EntryIcon} size={16} />
        </span>
        <span className={styles.itemName}>{entry.name}</span>
        {entry.isSymlink && <span className={styles.symlink}>{t('workingDirectory.symlink')}</span>}
      </Command.Item>
    );
  };

  return (
    <Command
      loop
      className={styles.command}
      label={t('workingDirectory.browseTitle')}
      shouldFilter={false}
      value={selectedValue}
      onValueChange={setSelectedValue}
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key === 'Enter' &&
          canSelectCurrentDirectory &&
          listing
        ) {
          event.preventDefault();
          void confirmPath(listing.path);
          return;
        }
        if (
          ((!event.shiftKey && event.key === 'Tab') || event.key === 'ArrowRight') &&
          selectedEntry
        ) {
          event.preventDefault();
          navigate(selectedEntry.path);
          return;
        }
        if (event.altKey && event.key === 'ArrowLeft' && listing?.parent) {
          event.preventDefault();
          navigate(listing.parent);
          return;
        }
        if (event.key === 'Enter' && !selectedValue && query.trim()) {
          event.preventDefault();
          void confirmPath(query);
        }
      }}
    >
      <Flexbox horizontal align={'center'} className={styles.deviceRow} gap={10}>
        <Icon icon={ServerIcon} size={18} />
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <span className={styles.deviceLabel}>{t('workingDirectory.browseDeviceLabel')}</span>
          <span className={styles.deviceName}>{deviceName}</span>
        </Flexbox>
      </Flexbox>

      <Flexbox className={styles.pathSection} gap={5}>
        <span className={styles.sectionLabel}>{t('workingDirectory.browseSourceFolder')}</span>
        <Flexbox
          horizontal
          align={'center'}
          className={cx(styles.pathRow, error && styles.pathRowError)}
          gap={8}
        >
          <Command.Input
            autoFocus
            aria-label={t('workingDirectory.browsePathLabel')}
            className={styles.pathInput}
            placeholder={t('workingDirectory.placeholder')}
            value={query}
            onValueChange={(value) => {
              setQuery(value);
              setListError(undefined);
              clearSelectionError();
            }}
          />
          {loading && <NeuralNetworkLoading size={16} />}
          <ActionIcon
            aria-label={t('workingDirectory.browseHome')}
            disabled={!home || selecting}
            icon={HomeIcon}
            size={'small'}
            title={t('workingDirectory.browseHome')}
            onClick={() => navigate(home)}
          />
          <ActionIcon
            aria-label={t('workingDirectory.browseParent')}
            disabled={!listing?.parent || selecting}
            icon={Undo2Icon}
            size={'small'}
            title={t('workingDirectory.browseParent')}
            onClick={() => listing?.parent && navigate(listing.parent)}
          />
        </Flexbox>
      </Flexbox>

      <Command.List>
        {!loading && errorMessage && (
          <div className={styles.empty}>
            <div>{errorMessage}</div>
            <div>{t('workingDirectory.browseManualHint')}</div>
            <Flexbox horizontal gap={8}>
              <Button
                icon={RefreshCwIcon}
                size={'small'}
                onClick={() => {
                  if (selectionError === 'SAVE_FAILED') {
                    void retrySave();
                    return;
                  }
                  void loadDirectory(retryPath, false);
                }}
              >
                {t('workingDirectory.browseRetry')}
              </Button>
              {home && !isSameRemotePath(queryDirectory, home, pathStyle) && (
                <Button icon={HomeIcon} size={'small'} onClick={() => navigate(home)}>
                  {t('workingDirectory.browseHome')}
                </Button>
              )}
            </Flexbox>
          </div>
        )}

        {!errorMessage && entries.map(renderEntry)}

        {loading && !listingMatchesQuery && (
          <div className={styles.empty}>
            <NeuralNetworkLoading size={28} />
            <div>{t('workingDirectory.browseLoading')}</div>
          </div>
        )}

        {!loading && !errorMessage && listingMatchesQuery && entries.length === 0 && (
          <div className={styles.empty}>
            {t(
              queryParts.suffix
                ? 'workingDirectory.browseNoMatch'
                : 'workingDirectory.browseNoFolders',
            )}
          </div>
        )}
      </Command.List>

      <Flexbox horizontal align={'center'} className={styles.footer} distribution={'space-between'}>
        <span className={styles.footerHint}>{t('workingDirectory.browseKeyboardHint')}</span>
        <Flexbox horizontal className={styles.footerActions} gap={8}>
          <Button onClick={close}>{tCommon('cancel')}</Button>
          <Button
            disabled={!canSelectCurrentDirectory}
            loading={selecting}
            type={'primary'}
            onClick={() => listing && void confirmPath(listing.path)}
          >
            {t('workingDirectory.browseSelectFolder')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Command>
  );
};

type OpenRemoteFolderPickerOptions = RemoteFolderPickerContentProps;

const RemoteFolderPickerTitle = () => {
  const { t } = useTranslation('device');
  return t('workingDirectory.browseTitle');
};

export const openRemoteFolderPickerModal = (
  options: OpenRemoteFolderPickerOptions,
): ModalInstance =>
  createModal({
    content: <RemoteFolderPickerContent {...options} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { overflow: 'hidden', padding: 0 },
      header: { borderBottom: `1px solid ${cssVar.colorSplit}` },
    },
    title: <RemoteFolderPickerTitle />,
    width: 'min(92vw, 720px)',
  });
