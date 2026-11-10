'use client';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { Github } from '@lobehub/icons';
import { Flexbox, Icon, Popover, Skeleton, Tag, Text, toast, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  ChevronDownIcon,
  FolderIcon,
  HardDriveIcon,
  InfoIcon,
  PackageIcon,
  TimerIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { openSandboxStorageUpsell } from '@/business/client/features/SandboxStorageUpsell';
import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { openCreateEnvironmentModal } from '@/features/EnvironmentManager/CreateEnvironmentModal';
import { openSandboxDirectoryModal } from '@/features/WorkingDirectory';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { environmentService } from '@/services/environment';
import { refreshProjectFiles } from '@/services/projectFile';
import { sandboxStorageService } from '@/services/sandboxStorage';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import OptionRow from './OptionRow';
import SandboxDriveMenu from './SandboxDriveMenu';
import { environmentChipState, pickableEnvironments } from './sandboxEnvironmentOptions';
import SandboxRepositoryMenu, { type SandboxRepositoryOption } from './SandboxRepositoryMenu';
import { isPersistentSelection, type SandboxSelection } from './useSandboxPlacement';
import { workingDirectoryChipStyles } from './workingDirectoryChipStyles';

const styles = stylex.create({
  header: {
    alignItems: 'center',
    display: 'flex',
    gap: 6,
    justifyContent: 'space-between',
    paddingBlock: 4,
    paddingInline: 8,
  },
  headerInfo: {
    color: cssVar.colorTextQuaternary,
    cursor: 'help',
  },
  headerTitle: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    fontWeight: 500,
  },
  notice: {
    backgroundColor: cssVar.colorWarningBg,
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorWarningText,
    fontSize: 12,
    paddingBlock: 8,
    paddingInline: 8,
  },
  warning: {
    color: cssVar.colorWarning,
  },
});

/**
 * A submenu's list can arrive after it opens. Left to size itself, its positioner
 * keeps the size it was first measured at, so the popup would grow off the screen
 * instead of being placed again.
 */
const SUBMENU_STYLES = {
  content: { padding: 4 },
  root: { height: 'auto', width: 'auto' },
};

interface SandboxDrivePickerProps {
  /** Whether this plan includes a drive. Without one the menu offers the way to a plan. */
  entitled: boolean;
  onChange: (selection: SandboxSelection) => Promise<void>;
  topicId?: string;
  /** Where this conversation works today. */
  value: SandboxSelection;
}

const folderName = (path: string) => path.split('/').pop() || path;

/**
 * Where a cloud-sandbox run works, offered the way the device picker offers
 * folders: the chip names the place, the menu holds the temporary sandbox and
 * the way into the drive's directory browser.
 *
 * Nothing picked is the temporary sandbox; picking a folder on the drive is
 * the choice to keep files. A pick that can no longer be honoured — the
 * folder was deleted — is said on the chip itself, before the next message
 * runs somewhere the person did not choose.
 *
 * A repository is the third kind of place, one level down: temporary, a folder
 * or a repository, one at a time. A checkout only lands in an empty folder, so
 * offering it beside a folder that holds files would let a pick silently do
 * nothing.
 *
 * A conversation from before environments became initializers may still be
 * bound to an environment directory; it is shown by name until another pick
 * replaces it.
 */
const SandboxDrivePicker = memo<SandboxDrivePickerProps>(
  ({ entitled, onChange, topicId, value }) => {
    const { t } = useTranslation(['chat', 'device']);
    const [open, setOpen] = useState(false);
    const workspaceId = useActiveWorkspaceId();
    const navigate = useWorkspaceAwareNavigate();
    const persistent = isPersistentSelection(value);
    const onRepository = !!value.environmentId;

    const {
      data: environmentList,
      error: environmentsError,
      mutate: refreshEnvironments,
    } = useSWR(['sandbox-environment-chip', workspaceId ?? ''], () =>
      environmentService.listEnvironments(),
    );
    const sharedAgent = useAgentStore(
      (s) => !!workspaceId && agentSelectors.currentAgentVisibility(s) === 'public',
    );
    const environments = pickableEnvironments(environmentList?.environments ?? [], sharedAgent);
    const repository = environments.find((item) => item.id === value.environmentId);
    // Picked once but no longer readable — deleted, or unpublished by its owner
    // — is said rather than hidden; a list that has not loaded says nothing.
    const repositoryState = environmentChipState({
      current: repository,
      environmentId: value.environmentId,
      failed: !!environmentsError,
      loaded: !!environmentList,
    });

    // A legacy environment directory's own row, for its name — from the
    // database, so the chip never waits on a sandbox.
    const { data: instance, isLoading: instanceLoading } = useSWR(
      entitled && value.instanceId ? ['sandbox-drive-chip-instance', value.instanceId] : null,
      () => sandboxStorageService.getInstance({ id: value.instanceId! }),
    );

    // Whether the pick still holds, asked of the same resolver the run uses:
    // a folder deleted on a shared drive, or an environment directory gone,
    // sends the next run to a temporary sandbox — and the chip says so first.
    const { data: placement, mutate: revalidatePlacement } = useSWR(
      entitled && topicId && persistent
        ? [
            'sandbox-drive-placement',
            topicId,
            value.drive ?? '',
            value.instanceId ?? '',
            value.workingDirectory ?? '',
          ]
        : null,
      () => sandboxStorageService.resolveSessionPlacement({ topicId }),
      { revalidateOnFocus: true },
    );
    const fallback = placement?.fallback;

    // Picking the folder already held keeps the keys unchanged, so SWR would
    // go on showing the old answers — "no longer exists" on the chip and an
    // unreadable tree in the working panel, for a folder just re-created and
    // picked again. Ask once more after every pick.
    const pick = async (selection: SandboxSelection) => {
      await onChange(selection);
      void revalidatePlacement();
      if (topicId && !selection.instanceId && selection.workingDirectory !== undefined) {
        const folder = selection.workingDirectory === '.' ? '' : selection.workingDirectory;
        void refreshProjectFiles(`sandbox:${topicId}`, folder);
      }
    };

    const select = async (selection: SandboxSelection) => {
      setOpen(false);
      try {
        await pick(selection);
      } catch {
        // The topic kept its old placement; said rather than left looking picked.
        toast.error(t('workingDirectory.drive.pickFailed', { ns: 'device' }));
      }
    };

    // A repository is only cloned into an empty folder, so it never inherits the
    // folder the conversation was on: it starts in a temporary sandbox.
    const pickRepository = async (environment: SandboxRepositoryOption) => {
      try {
        await onChange({ environmentId: environment.id });
        void revalidatePlacement();
      } catch {
        // The topic kept its place; said rather than left looking changed.
        toast.error(t('sandboxEnvironment.saveFailed'));
      }
    };

    const addRepository = () => {
      setOpen(false);
      openCreateEnvironmentModal(
        // A workspace-public agent applies published environments only.
        sharedAgent ? 'public' : undefined,
        async (created) => {
          await refreshEnvironments();
          if (created?.id) await pickRepository(created);
        },
        t('sandboxEnvironment.add'),
      );
    };

    const openBrowser = () => {
      setOpen(false);
      openSandboxDirectoryModal({
        // A folder that is gone cannot be listed; start from the top instead.
        defaultPath:
          value.workingDirectory &&
          value.workingDirectory !== '.' &&
          fallback !== 'directoryMissing'
            ? value.workingDirectory
            : undefined,
        drive: value.drive,
        isWorkspace: !!workspaceId,
        onPick: pick,
      });
    };

    const currentLabel = value.instanceId
      ? (instance?.name ?? instance?.workingDirectory)
      : value.workingDirectory === '.'
        ? t('sandboxDrive.root')
        : value.workingDirectory
          ? folderName(value.workingDirectory)
          : undefined;
    const currentIcon = value.instanceId ? PackageIcon : FolderIcon;
    const showFolder = persistent && !onRepository;

    const fallbackMessage = fallback ? t(`sandboxDrive.fallback.${fallback}`) : undefined;
    const chipIcon = fallback ? (
      <Icon icon={TriangleAlertIcon} size={14} />
    ) : onRepository ? (
      <Github size={14} />
    ) : persistent ? (
      <Icon icon={currentIcon} size={14} />
    ) : (
      <Icon icon={TimerIcon} size={14} />
    );
    const repositoryLabel =
      repositoryState.kind === 'picked'
        ? repositoryState.name
        : repositoryState.kind === 'missing'
          ? t('sandboxEnvironment.missing')
          : repositoryState.kind === 'loadFailed'
            ? t('sandboxEnvironment.loadFailed')
            : t('sandboxEnvironment.loading');
    const chipLabel = fallback
      ? t(`sandboxDrive.fallbackChip.${fallback}`)
      : onRepository
        ? repositoryLabel
        : persistent
          ? currentLabel
          : t('sandboxStorage.ephemeral');

    const content = (
      <Flexbox gap={2} style={{ maxWidth: 360, minWidth: 280 }}>
        <div {...stylex.props(styles.header)}>
          <Flexbox horizontal align={'center'} gap={4}>
            <span {...stylex.props(styles.headerTitle)}>{t('sandboxDrive.pickerTitle')}</span>
            <Tooltip title={t('sandboxDrive.pickerInfoTooltip')}>
              <span {...stylex.props(styles.headerInfo)}>
                <Icon icon={InfoIcon} size={12} />
              </span>
            </Tooltip>
          </Flexbox>
        </div>

        {fallbackMessage && (
          <Text className={stylex.props(styles.notice).className}>{fallbackMessage}</Text>
        )}

        <OptionRow
          compact
          active={!persistent && !onRepository}
          icon={<Icon icon={TimerIcon} size={16} />}
          label={t('sandboxStorage.ephemeral')}
          onClick={() => void select({})}
        />

        {ENABLE_BUSINESS_FEATURES &&
          (entitled ? (
            <Popover
              arrow={false}
              closeDelay={150}
              placement={'rightBottom'}
              styles={SUBMENU_STYLES}
              trigger={['hover', 'click']}
              content={
                <SandboxDriveMenu
                  selectedLabel={showFolder ? currentLabel : undefined}
                  selectedPath={showFolder ? value.workingDirectory : undefined}
                  onBrowse={openBrowser}
                  onPick={(folder) => void select(folder)}
                />
              }
            >
              <div data-testid={'sandbox-drive-row'}>
                <OptionRow
                  arrow
                  compact
                  active={showFolder}
                  icon={<Icon icon={HardDriveIcon} size={16} />}
                  label={t('sandboxDrive.title')}
                  onClick={() => {}}
                />
              </div>
            </Popover>
          ) : (
            // The drive is part of a plan this account is not on. Offered in the
            // same list, in the same shape, so the row reads as one more place
            // files could go — and the tag says why it is not simply selectable.
            <OptionRow
              compact
              icon={<Icon icon={HardDriveIcon} size={16} />}
              label={t('sandboxDrive.title')}
              badge={
                <Tag color={'gold'} size={'small'} style={{ borderRadius: 999, paddingInline: 8 }}>
                  {t('pro', { ns: 'common' })}
                </Tag>
              }
              onClick={() => {
                setOpen(false);
                openSandboxStorageUpsell();
              }}
            />
          ))}

        <Popover
          arrow={false}
          closeDelay={150}
          placement={'rightBottom'}
          styles={SUBMENU_STYLES}
          trigger={['hover', 'click']}
          content={
            <SandboxRepositoryMenu
              environments={environments}
              failed={!!environmentsError}
              loaded={!!environmentList}
              selectedId={value.environmentId}
              onAdd={addRepository}
              onClose={() => setOpen(false)}
              onPick={pickRepository}
              onRetry={() => void refreshEnvironments()}
              onManage={() => {
                setOpen(false);
                navigate('/settings/environments');
              }}
            />
          }
        >
          <div data-testid={'sandbox-repository-row'}>
            <OptionRow
              arrow
              compact
              active={onRepository}
              icon={<Github size={16} />}
              label={t('sandboxEnvironment.title')}
              onClick={() => {}}
            />
          </div>
        </Popover>
      </Flexbox>
    );

    const resolving = !!value.instanceId && !instance && instanceLoading;

    // A plain div between the popover and the chip, as the device picker has:
    // the popover merges trigger props into its direct child.
    return (
      <Popover
        arrow={false}
        content={content}
        open={open}
        placement={'topLeft'}
        styles={{ content: { padding: 4 } }}
        trigger={'click'}
        onOpenChange={setOpen}
      >
        <div>
          <Tooltip title={fallbackMessage}>
            <div
              data-testid={'sandbox-drive-chip'}
              {...stylex.props(workingDirectoryChipStyles.chip, fallback && styles.warning)}
            >
              {chipIcon}
              {resolving ? (
                <Skeleton.Text rows={1} style={{ height: 12, width: 56 }} />
              ) : (
                <span {...stylex.props(workingDirectoryChipStyles.label)}>{chipLabel}</span>
              )}
              <Icon icon={ChevronDownIcon} size={12} />
            </div>
          </Tooltip>
        </div>
      </Popover>
    );
  },
);

SandboxDrivePicker.displayName = 'SandboxDrivePicker';

export default SandboxDrivePicker;
