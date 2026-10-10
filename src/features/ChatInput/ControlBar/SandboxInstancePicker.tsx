'use client';

import { environmentKind } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { confirmModal, Popover, Skeleton, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  ChevronDownIcon,
  FolderClockIcon,
  FolderIcon,
  InfoIcon,
  LockIcon,
  PlusIcon,
  SettingsIcon,
  TimerIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { openSandboxStorageUpsell } from '@/business/client/features/SandboxStorageUpsell';
import { describeError } from '@/features/EnvironmentManager/errorMessage';
import { settleThenRefresh } from '@/features/EnvironmentManager/settleThenRefresh';
import { useCanEditEnvironment } from '@/features/EnvironmentManager/useCanEditEnvironment';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { sandboxStorageService } from '@/services/sandboxStorage';

import OptionRow from './OptionRow';
import SandboxEnvironmentRow from './SandboxEnvironmentRow';
import {
  copyChipLabel,
  describeEnvironmentRow,
  isCopyBuilding,
  isCopyOccupied,
} from './sandboxEnvironmentRows';
import { useCreateCopy } from './useCreateCopy';
import { usePendingIds } from './usePendingIds';
import type { SandboxSelection } from './useSandboxMode';
import { workingDirectoryChipStyles } from './workingDirectoryChipStyles';

export type { SandboxSelection } from './useSandboxMode';

const styles = createStaticStyles(({ css }) => ({
  /** The environment and the directory on an instance's second line. */
  environmentRow: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  /**
   * The pool caption, in the execution-target menu's own shape. The space
   * above it is what makes it a section start instead of one more line: two
   * grey captions stacked with even spacing read as a pair, not as a heading
   * over its contents.
   */
  groupLabel: css`
    margin-block-start: 6px;
    padding-block: 4px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextQuaternary};
  `,
  /** Title, its explainer and the way out — the execution-device menu's header. */
  header: css`
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: space-between;

    padding-block: 4px;
  `,
  headerInfo: css`
    cursor: help;
    color: ${cssVar.colorTextQuaternary};
    transition: color 0.2s;

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  headerTitle: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
  manageButton: css`
    cursor: pointer;

    display: flex;
    gap: 3px;
    align-items: center;

    padding: 0;
    border: none;

    font-size: 11px;
    color: ${cssVar.colorTextQuaternary};

    background: none;

    transition: color 0.2s;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
  notice: css`
    padding-block: 8px;
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  option: css`
    && {
      padding-inline: 0;
    }
  `,
  skeletonRow: css`
    display: flex;
    gap: 10px;
    align-items: center;
    padding-block: 8px;
  `,
  blocked: css`
    color: ${cssVar.colorWarning};
  `,
  blockedNotice: css`
    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;
    color: ${cssVar.colorWarningText};

    background: ${cssVar.colorWarningBg};
  `,
  temporary: css`
    padding-block-end: 4px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

/**
 * The shape the instance list is about to take: a caption over a row. Without it the section is simply absent while
 * the list loads and then snaps into either a list or a "create one" row — and
 * an empty gap where a choice belongs reads as "there is nothing here", which
 * is the one thing it does not yet know.
 */
const EnvironmentSectionSkeleton = memo(() => (
  <Flexbox gap={2}>
    <Skeleton.Text className={styles.environmentRow} rows={1} style={{ width: 96 }} />
    <div className={styles.skeletonRow}>
      <Skeleton.Avatar shape={'square'} size={28} />
      <Flexbox flex={1} gap={4}>
        <Skeleton.Text rows={1} style={{ width: 120 }} />
        <Skeleton.Text rows={1} style={{ width: 180 }} />
      </Flexbox>
    </div>
  </Flexbox>
));

EnvironmentSectionSkeleton.displayName = 'SandboxInstancePicker.EnvironmentSectionSkeleton';

interface SandboxInstancePickerProps {
  /**
   * Whether the conversation's agent is shared with the workspace. Such an
   * agent runs on its caller's session, and a private environment's captured
   * state can hold that caller's credentials — so the server will not run it
   * in one, and the menu says so rather than offering what cannot be used.
   */
  agentIsPublic?: boolean;
  /** Whether this plan includes a persistent workspace. Without one, the menu
   *  offers the temporary directory and the way to a plan. */
  entitled: boolean;
  onChange: (selection: SandboxSelection) => Promise<void>;
  /**
   * Topic whose warm sandbox session serves the instance listing. Absent on a
   * conversation that has not been created yet — the call takes it as an
   * optimization, never as a scope, so it simply pays a cold start.
   */
  topicId?: string;
  /** Where this conversation keeps its files today. */
  value: SandboxSelection;
}

/** How often a building copy is re-listed while the picker can see it. */
const BUILD_REFRESH_MS = 4000;

/**
 * Where a cloud-sandbox run keeps its files, offered the way the local picker
 * offers folders: the chip names the slot, the menu lists the places.
 *
 * The temporary directory comes first because it is what a run gets by
 * choosing nothing — naming it keeps that state visible and lets a run go back
 * to it. Below it, the environments: what people choose is an environment, and
 * the copy (instance) of it a conversation lands in is picked for them — the
 * one it already uses, else the default, else the first free one. Copies only
 * surface, in a second menu, when an environment has more than one. The topic
 * still stores the copy's id, so a conversation's files never move.
 *
 * Names, not sizes: sizes live in the snapshot store, which needs a live sandbox
 * session to answer, and a picker that takes seconds to open is a picker people
 * stop opening. The settings page is where sizes are worth the wait.
 */
const SandboxInstancePicker = memo<SandboxInstancePickerProps>(
  ({ agentIsPublic, entitled, onChange, topicId, value }) => {
    // The slot's own name comes from the device namespace on purpose: the local
    // picker and this one are the same slot, and a second string meaning
    // "working directory" would be one more pair to keep in step.
    const { t } = useTranslation(['chat', 'device', 'setting']);
    const [open, setOpen] = useState(false);
    // Copies whose run is being stopped from this menu.
    const stopping = usePendingIds();
    const canEdit = useCanEditEnvironment();
    const navigate = useWorkspaceAwareNavigate();

    const boundInstanceId = value.mode === 'persistent' ? value.instanceId : undefined;

    // Fetched while CLOSED whenever a copy is bound, because the chip names
    // it by looking it up in this list: gating the list on `open` alone leaves
    // the closed chip with nothing to look up.
    const {
      data,
      isLoading: instancesLoading,
      mutate: refreshInstances,
    } = useSWR(
      entitled && (open || boundInstanceId) ? ['sandbox-instances', topicId] : null,
      () => sandboxStorageService.listInstances({ topicId, withSizes: false }),
      // The topic is in the key because occupancy is answered per conversation
      // — "in use by another one" is a different answer here than there. The
      // instances themselves are the same list either way, so the first send,
      // which takes the topic from none to one, must not blank the chip: it
      // would flash a skeleton for a name that never changed. Kept until the
      // refetch lands; a moment of last-known occupancy is not worth that.
      {
        keepPreviousData: true,
        // A building copy settles on a listing, so keep listing while one is
        // building: "Building" has to turn into a usable row on its own.
        refreshInterval: (latest) =>
          latest?.instances.some((instance) => instance.status === 'pending')
            ? BUILD_REFRESH_MS
            : 0,
        revalidateOnFocus: false,
      },
    );
    const {
      data: environmentData,
      error: environmentError,
      isLoading: environmentsLoading,
      // Also while closed when a copy is bound: whether that copy is still
      // usable depends on its environment's visibility.
    } = useSWR(entitled && (open || boundInstanceId) ? 'sandbox-environments' : null, () =>
      sandboxStorageService.listEnvironments(),
    );

    const instances = data?.instances ?? [];
    const environments = environmentData?.environments ?? [];
    const current = instances.find((instance) => instance.id === boundInstanceId);
    // The server's rule, mirrored: only inside a workspace, where private and
    // published are two different things. A personal environment is always
    // private and always the owner's own, so it stays usable.
    const isBlocked = (environmentId: string) => {
      if (!agentIsPublic) return false;
      const environment = environments.find((item) => item.id === environmentId);
      return Boolean(environment?.workspaceId) && environment?.visibility === 'private';
    };
    const currentBlocked = current ? isBlocked(current.environmentId) : false;

    // What this agent can actually pick. A public agent's own private
    // environments are dropped rather than dimmed — the execution-target menu
    // treats a workspace agent's personal devices the same way, and for the
    // same reason: a list of things that cannot be chosen reads as a fault,
    // not as help. The one line below says where they went.
    const selectable = environments.filter((environment) => !isBlocked(environment.id));
    const hiddenPrivateCount = environments.length - selectable.length;

    const environmentById = new Map(
      environments.map((environment) => [environment.id, environment]),
    );
    const copiesOf = (environmentId: string) =>
      instances.filter((instance) => instance.environmentId === environmentId);
    const currentEnvironment = current ? environmentById.get(current.environmentId) : undefined;

    // Inside a workspace an environment belongs to one of two pools, and which
    // one decides who else can reach what a run leaves behind — so the menu
    // says which pool it is looking at, the way the execution-target menu
    // splits private from workspace devices. A personal account has one pool
    // and no such question, so it stays flat.
    const inWorkspace = selectable.some((environment) => Boolean(environment.workspaceId));
    const privatePool = inWorkspace
      ? selectable.filter((environment) => environment.visibility === 'private')
      : [];
    const workspacePool = inWorkspace
      ? selectable.filter((environment) => environment.visibility !== 'private')
      : [];

    // Only once BOTH lists have arrived: undefined is "not known yet", not
    // "none". With no environment at all there is nothing to pick, so the row
    // says to set one up.
    const listsReady = Boolean(environmentData) && Boolean(data);
    const hasNoEnvironments = listsReady && selectable.length === 0;

    const select = async (selection: SandboxSelection) => {
      setOpen(false);
      await onChange(selection);
    };

    const leaveTo = (action: () => void) => {
      setOpen(false);
      action();
    };

    // The same stop the settings row offers, from the place the person found
    // the copy blocked. The dialog and its outcomes are that row's own words,
    // so the two surfaces cannot drift into describing it differently. Keys
    // are checked per namespace, and these are the settings row's.
    const translate = t as (key: string, options?: Record<string, unknown>) => string;
    const tSetting = (key: string, options?: Record<string, unknown>) =>
      translate(key, { ...options, ns: 'setting' });
    const confirmStop = (instance: { id: string; name: string }) =>
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: tSetting('environments.instances.stopConfirmContent'),
        okText: tSetting('environments.instances.stop'),
        onOk: () => {
          stopping.add(instance.id);
          // Refreshed either way — a refusal may land after the run ended on
          // its own — and the row stays busy until the refreshed list is in,
          // so it never reads free on the toast and locked on the row.
          void settleThenRefresh(
            () => sandboxStorageService.stopInstance({ id: instance.id }),
            refreshInstances,
          )
            .then(({ stopped }) =>
              toast.success(
                tSetting(
                  stopped ? 'environments.instances.stopped' : 'environments.instances.stopNothing',
                  { name: instance.name },
                ),
              ),
            )
            .catch((error: unknown) =>
              toast.error(
                describeError(error, tSetting, tSetting('environments.instances.stopFailed')),
              ),
            )
            .finally(() => stopping.remove(instance.id));
        },
        title: tSetting('environments.instances.stopConfirmTitle', { name: instance.name }),
      });

    // Lazily for an environment with no copy yet, or as another copy when the
    // ones there are taken — see `useCreateCopy`.
    const { create: createCopy, isPreparing } = useCreateCopy({
      onBuildError: (error) =>
        toast.error(
          describeError(error, tSetting, tSetting('environments.instances.buildStartFailed')),
        ),
      onChange,
      refreshInstances,
      topicId,
    });
    const createCopyAndBind = (environmentId: string, failedKey: string) =>
      createCopy(environmentId, (error) =>
        toast.error(describeError(error, tSetting, translate(failedKey))),
      );

    const renderEnvironment = (environment: (typeof environments)[number]) => {
      const isCreator = canEdit(environment);
      const kind = environmentKind(environment);
      const row = describeEnvironmentRow({
        boundInstanceId,
        copies: copiesOf(environment.id),
        isCreator,
        kind,
      });

      return (
        <SandboxEnvironmentRow
          boundInstanceId={boundInstanceId}
          busy={isPreparing(environment.id)}
          environment={environment}
          isCreator={isCreator}
          key={environment.id}
          kind={kind}
          row={row}
          stopping={stopping.has}
          onReopen={() => void createCopyAndBind(environment.id, 'sandboxStorage.reopenCopyFailed')}
          onSelectCopy={(copy) => void select({ instanceId: copy.id, mode: 'persistent' })}
          onStop={confirmStop}
          onSelectLazy={() => {
            setOpen(false);
            void createCopyAndBind(environment.id, 'sandboxStorage.createCopyFailed');
          }}
        />
      );
    };

    // The chip names what was chosen — an environment (and its copy, when it
    // has several), or the temporary directory once it has been picked on
    // purpose — and otherwise the slot itself, the same words the local chip
    // shows before a folder is chosen. The default is not a choice, so it does
    // not get named as one.
    // A node rather than an icon component, because the GitHub mark a code
    // environment shows is not a lucide glyph.
    const chipIcon = (() => {
      if (!current) {
        return value.mode === 'ephemeral' ? (
          <Icon icon={TimerIcon} size={14} />
        ) : (
          <Icon icon={FolderIcon} size={14} />
        );
      }
      if (currentBlocked) return <Icon icon={LockIcon} size={14} />;
      return environmentKind(currentEnvironment) === 'files' ? (
        <Icon icon={FolderIcon} size={14} />
      ) : (
        <Github size={14} />
      );
    })();

    // A copy is bound and the list that names it has not arrived. The key
    // carries the topic, so the first send — the moment a conversation goes
    // from none to one — refetches it, and the fallback below would spend that
    // window saying the opposite of the truth: the chip read "working
    // directory", as though nothing had been chosen, seconds after the person
    // chose it and while the run was already using it.
    const resolvingInstance = !!boundInstanceId && !current && instancesLoading;
    const chipLabel = current
      ? copyChipLabel({
          copy: current,
          copyCount: copiesOf(current.environmentId).length,
          environmentName: currentEnvironment?.name,
        })
      : value.mode === 'ephemeral'
        ? t('sandboxStorage.ephemeral')
        : t('workingDirectory.title', { ns: 'device' });

    // Built before the popover on purpose. The dev-time code inspector marks one
    // file per session by appending an invisible element inside that file's FIRST
    // JSX element; were that the popover, its trigger would become a list, and a
    // list is not an element the popover can merge its props into — it falls back
    // to wrapping everything in a native <button>, box and all. A Flexbox with one
    // more empty child is harmless.
    const content = (
      <Flexbox gap={2} style={{ maxWidth: 360, minWidth: 280 }}>
        <div className={styles.header}>
          <Flexbox horizontal align={'center'} gap={4}>
            <span className={styles.headerTitle}>{t('sandboxStorage.pickerTitle')}</span>
            <Tooltip title={t('sandboxStorage.pickerInfoTooltip')}>
              <span className={styles.headerInfo}>
                <Icon icon={InfoIcon} size={12} />
              </span>
            </Tooltip>
          </Flexbox>
          {entitled && (
            <button
              className={styles.manageButton}
              type={'button'}
              onClick={() => leaveTo(() => navigate('/settings/environments'))}
            >
              <Icon icon={SettingsIcon} size={11} />
              <span>{t('sandboxStorage.manage')}</span>
            </button>
          )}
        </div>

        {current && currentBlocked && (
          <Text className={styles.blockedNotice}>
            {t('sandboxStorage.privateInstanceBlocked', { name: current.name })}
          </Text>
        )}

        {/* This conversation's own instance, held by another one. It stays
            bound — the lease may well be free again by the next message — but
            saying nothing would leave a 409 to do the explaining. A copy that
            is still building holds the same lease, but no conversation is
            running in it: its row already says "Building". */}
        {current && !currentBlocked && isCopyOccupied(current) && !isCopyBuilding(current) && (
          <Text className={styles.blockedNotice}>
            {t('sandboxStorage.instanceBusy', { name: current.name })}
          </Text>
        )}

        <Flexbox className={styles.temporary}>
          <OptionRow
            active={value.mode === 'ephemeral'}
            className={styles.option}
            desc={t('sandboxStorage.ephemeralDesc')}
            icon={<Icon icon={TimerIcon} size={16} />}
            label={t('sandboxStorage.ephemeral')}
            onClick={() => void select({ mode: 'ephemeral' })}
          />
        </Flexbox>

        {!entitled && (
          // Persistence is part of a plan this account is not on. Offered
          // in the same list, in the same shape, so the row reads as one
          // more place files could go — and the tag says why it is not
          // simply selectable.
          <OptionRow
            className={styles.option}
            desc={t('sandboxStorage.persistentUpsellDesc')}
            icon={<Icon icon={FolderClockIcon} size={16} />}
            label={t('sandboxStorage.persistentUpsell')}
            tag={t('pro', { ns: 'common' })}
            onClick={() => leaveTo(openSandboxStorageUpsell)}
          />
        )}

        {entitled && (environmentsLoading || instancesLoading) && <EnvironmentSectionSkeleton />}

        {entitled && environmentError && (
          <Text className={styles.notice}>{t('sandboxStorage.environmentsUnavailable')}</Text>
        )}

        {entitled && hasNoEnvironments && (
          // Nothing to choose from yet: environments are made on the
          // environment page — this menu picks, it does not author.
          <OptionRow
            className={styles.option}
            desc={t('sandboxStorage.setUpEnvironmentDesc')}
            icon={<Icon icon={PlusIcon} size={16} />}
            label={t('sandboxStorage.setUpEnvironment')}
            onClick={() => leaveTo(() => navigate('/settings/environments'))}
          />
        )}

        {entitled && listsReady && !inWorkspace && selectable.map(renderEnvironment)}

        {entitled && listsReady && inWorkspace && privatePool.length > 0 && (
          <>
            <div className={styles.groupLabel}>{t('sandboxStorage.privateGroup')}</div>
            {privatePool.map(renderEnvironment)}
          </>
        )}

        {entitled && listsReady && inWorkspace && workspacePool.length > 0 && (
          <>
            <div className={styles.groupLabel}>{t('sandboxStorage.workspaceGroup')}</div>
            {workspacePool.map(renderEnvironment)}
          </>
        )}

        {/* Where the hidden ones went, and how to get one back — the device
            menu's enroll hint, in this menu's terms. One line however many
            were dropped; which ones is the settings page's job. */}
        {entitled && hiddenPrivateCount > 0 && (
          <Text className={styles.notice}>
            {t('sandboxStorage.publicAgentHint', { count: hiddenPrivateCount })}
          </Text>
        )}
      </Flexbox>
    );

    // A plain div between the popover and the chip, as the local picker has.
    // The popover merges trigger props — role, open state, focus styling —
    // into its direct child; on the styled chip they drew a box around it. On
    // this wrapper they land on nothing visible.
    return (
      <Popover
        arrow={false}
        content={content}
        open={open}
        placement={'topLeft'}
        trigger={'click'}
        onOpenChange={(next) => {
          setOpen(next);
          // Occupancy moves on its own — a run ends, a build releases its
          // lease — and the list is not refetched on focus. Re-read it each
          // time the menu opens, so a copy is not offered or refused on a
          // stale answer. A Redis read on the server, never a sandbox.
          if (next && data) void refreshInstances();
        }}
      >
        <div>
          <Tooltip
            title={
              current && currentBlocked
                ? t('sandboxStorage.privateInstanceBlocked', { name: current.name })
                : undefined
            }
          >
            <div className={cx(workingDirectoryChipStyles.chip, currentBlocked && styles.blocked)}>
              {chipIcon}
              {resolvingInstance ? (
                <Skeleton.Text rows={1} style={{ height: 12, width: 56 }} />
              ) : (
                <span className={workingDirectoryChipStyles.label}>{chipLabel}</span>
              )}
              <Icon icon={ChevronDownIcon} size={12} />
            </div>
          </Tooltip>
        </div>
      </Popover>
    );
  },
);

SandboxInstancePicker.displayName = 'SandboxInstancePicker';

export default SandboxInstancePicker;
