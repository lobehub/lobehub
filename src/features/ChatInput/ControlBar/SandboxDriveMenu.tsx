'use client';

import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import { SANDBOX_DRIVE_ROOT } from '@lobechat/builtin-tool-cloud-sandbox';
import { Button, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FolderIcon, FolderOpenIcon, HardDriveIcon, HomeIcon, TimerIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { sandboxStorageService } from '@/services/sandboxStorage';

import OptionRow from './OptionRow';

const styles = stylex.create({
  divider: {
    height: 1,
    marginBlock: 4,
    marginInline: 8,
    backgroundColor: cssVar.colorBorderSecondary,
  },
  hint: {
    paddingInline: '8px',
    fontSize: '12px',
    color: cssVar.colorTextDescription,
  },
  list: {
    maxHeight: '280px',
    overflowY: 'auto',
  },
});

export interface SandboxDriveFolderPick {
  drive?: SandboxDrive;
  workingDirectory: string;
}

interface SandboxDriveMenuProps {
  /**
   * Whether this plan includes a drive. Without one the folders are replaced by
   * a single drive row leading to a plan; `undefined` hides the drive entirely
   * (a deployment without one).
   */
  entitled?: boolean;
  /** Opens the full directory browser, for folders this short list does not reach. */
  onBrowse: () => void;
  onPick: (pick: SandboxDriveFolderPick) => void;
  onPickTemporary: () => void;
  onUpgrade: () => void;
  /** The label of a pick the list cannot show: a nested folder, or another drive. */
  selectedLabel?: string;
  /** The folder the conversation is on, when it is on one. */
  selectedPath?: string;
  /** Whether the conversation runs in a temporary sandbox. */
  temporary: boolean;
}

/**
 * Where the cloud sandbox keeps its files, one level under its storage option:
 * a temporary sandbox, or a folder of the conversation's own drive — its top
 * folders, and the way into the full browser. The list lives here so it is
 * only fetched once it is opened.
 */
const SandboxDriveMenu = memo<SandboxDriveMenuProps>(
  ({
    entitled,
    onBrowse,
    onPick,
    onPickTemporary,
    onUpgrade,
    selectedLabel,
    selectedPath,
    temporary,
  }) => {
    const { t } = useTranslation(['chat', 'device', 'common']);
    const workspaceId = useActiveWorkspaceId();
    // The public drive's root is not a place to work, so a workspace starts on
    // the member's own drive, as a new conversation does.
    const drive: SandboxDrive | undefined = workspaceId ? 'personal' : undefined;

    const { data, error, mutate } = useSWR(
      entitled ? ['sandbox-drive-menu-folders', workspaceId ?? '', drive ?? ''] : null,
      () => sandboxStorageService.listFiles({ drive }),
      { revalidateOnFocus: false, shouldRetryOnError: false },
    );
    const folders = (data?.entries ?? [])
      .filter((entry) => entry.isDirectory)
      .sort((a, b) => a.name.localeCompare(b.name));

    const listed =
      selectedPath === SANDBOX_DRIVE_ROOT || folders.some((item) => item.path === selectedPath);

    return (
      <Flexbox gap={2} style={{ maxWidth: 320, minWidth: 220 }}>
        <OptionRow
          compact
          active={temporary}
          icon={<Icon icon={TimerIcon} size={16} />}
          label={t('sandboxOptions.temporary')}
          onClick={onPickTemporary}
        />

        {entitled === false && (
          <OptionRow
            compact
            icon={<Icon icon={HardDriveIcon} size={16} />}
            label={t('sandboxDrive.title')}
            badge={
              <Tag color={'gold'} size={'small'} style={{ borderRadius: 999, paddingInline: 8 }}>
                {t('pro', { ns: 'common' })}
              </Tag>
            }
            onClick={onUpgrade}
          />
        )}

        {entitled && (
          <>
            <div {...stylex.props(styles.divider)} />
            <div {...stylex.props(styles.list)}>
              {selectedLabel && !listed && (
                <OptionRow
                  active
                  compact
                  icon={<Icon icon={FolderIcon} size={16} />}
                  label={selectedLabel}
                  onClick={() => {
                    if (selectedPath) onPick({ drive, workingDirectory: selectedPath });
                  }}
                />
              )}
              <OptionRow
                compact
                active={selectedPath === SANDBOX_DRIVE_ROOT}
                icon={<Icon icon={HomeIcon} size={16} />}
                label={t('sandboxDrive.root')}
                onClick={() => onPick({ drive, workingDirectory: SANDBOX_DRIVE_ROOT })}
              />
              {folders.map((folder) => (
                <OptionRow
                  compact
                  active={folder.path === selectedPath}
                  icon={<Icon icon={FolderIcon} size={16} />}
                  key={folder.path}
                  label={folder.name}
                  onClick={() => onPick({ drive, workingDirectory: folder.path })}
                />
              ))}
            </div>

            {error && (
              <Flexbox
                horizontal
                align={'center'}
                gap={8}
                justify={'space-between'}
                paddingInline={8}
              >
                <Text className={stylex.props(styles.hint).className} type={'danger'}>
                  {t('workingDirectory.drive.foldersLoadFailed', { ns: 'device' })}
                </Text>
                <Button onClick={() => void mutate()}>{t('retry', { ns: 'common' })}</Button>
              </Flexbox>
            )}

            <OptionRow
              compact
              icon={<Icon icon={FolderOpenIcon} size={16} />}
              label={t('sandboxDrive.browseOther')}
              onClick={onBrowse}
            />
          </>
        )}
      </Flexbox>
    );
  },
);

SandboxDriveMenu.displayName = 'SandboxDriveMenu';

export default SandboxDriveMenu;
