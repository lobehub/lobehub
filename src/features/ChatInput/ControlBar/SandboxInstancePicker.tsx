'use client';

import { Github } from '@lobehub/icons';
import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { Skeleton, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  AppWindowMacIcon,
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

import { openSandboxWorkspaceUpsell } from '@/business/client/features/SandboxWorkspaceUpsell';
import { repositoryPath } from '@/features/EnvironmentManager/repository';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { sandboxWorkspaceService } from '@/services/sandboxWorkspace';

import OptionRow from './OptionRow';
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
    padding-inline: 8px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextQuaternary};
    text-transform: uppercase;
    letter-spacing: 0.04em;
  `,
  /** Title, its explainer and the way out — the execution-device menu's header. */
  header: css`
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: space-between;

    padding-block: 4px;
    padding-inline: 8px;
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
    padding-inline: 8px;
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  skeletonRow: css`
    display: flex;
    gap: 10px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 8px;
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

const INSTANCE_ICON = AppWindowMacIcon;

/**
 * Where a cloud-sandbox run keeps its files, offered the way the local picker
 * offers folders: the chip names the slot, the menu lists the places.
 *
 * The temporary directory comes first because it is what a run gets by
 * choosing nothing — naming it keeps that state visible and lets a run go back
 * to it. Below it, the instances themselves, flat: an instance is the only
 * thing here files can actually go into, and nesting each one under its
 * environment spent a line per environment to say what the instance's own
 * second line already says. Environments are named there, and made on the
 * environment page — this menu picks, it does not author.
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
    const { t } = useTranslation(['chat', 'device']);
    const [open, setOpen] = useState(false);
    const navigate = useWorkspaceAwareNavigate();

    const boundInstanceId = value.mode === 'persistent' ? value.instanceId : undefined;

    // Fetched while CLOSED whenever an instance is bound, because the chip names
    // it by looking it up in this list: gating the list on `open` alone leaves
    // the closed chip with nothing to look up.
    const { data, isLoading: instancesLoading } = useSWR(
      entitled && (open || boundInstanceId) ? ['sandbox-instances', topicId] : null,
      () => sandboxWorkspaceService.listInstances({ topicId, withSizes: false }),
      { revalidateOnFocus: false },
    );
    const {
      data: environmentData,
      error: environmentError,
      isLoading: environmentsLoading,
      // Also while closed when an instance is bound: whether that instance
      // is still usable depends on its environment's visibility.
    } = useSWR(entitled && (open || boundInstanceId) ? 'sandbox-environments' : null, () =>
      sandboxWorkspaceService.listEnvironments(),
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

    // The menu lists instances, not environments. An environment is what an
    // instance was made from — it names the instance and supplies its icon —
    // but it is not itself a place files can go, so it no longer gets a row of
    // its own to nest under. Making one is the environment page's job.
    const selectableInstances = instances.filter((instance) => {
      const environment = environmentById.get(instance.environmentId);
      return Boolean(environment) && !isBlocked(instance.environmentId);
    });

    // Inside a workspace an instance belongs to one of two pools, through its
    // environment, and which one decides who else can reach what a run leaves
    // behind — so the menu says which pool it is looking at, the way the
    // execution-target menu splits private from workspace devices. A personal
    // account has one pool and no such question, so it stays flat.
    const inWorkspace = selectable.some((environment) => Boolean(environment.workspaceId));
    const poolOf = (instance: (typeof instances)[number]) =>
      environmentById.get(instance.environmentId)?.visibility === 'private'
        ? 'private'
        : 'workspace';
    const privatePool = inWorkspace
      ? selectableInstances.filter((instance) => poolOf(instance) === 'private')
      : [];
    const workspacePool = inWorkspace
      ? selectableInstances.filter((instance) => poolOf(instance) === 'workspace')
      : [];

    // Only once BOTH lists have arrived: undefined is "not known yet", not
    // "none", and instances alone cannot be judged — an instance whose
    // environment is hidden from this agent is not one of this menu's choices.
    const listsReady = Boolean(environmentData) && Boolean(data);
    const hasNoInstances = listsReady && selectableInstances.length === 0;
    // Which of the two empty states this is. With no environment at all there
    // is nothing to make an instance of, so the row says to set one up; with
    // an environment but no instance, the environment page is where the copy
    // gets made.
    const hasNoEnvironments = hasNoInstances && selectable.length === 0;

    const select = async (selection: SandboxSelection) => {
      setOpen(false);
      await onChange(selection);
    };

    const leaveTo = (action: () => void) => {
      setOpen(false);
      action();
    };

    const renderInstance = (instance: (typeof instances)[number]) => {
      const environment = environmentById.get(instance.environmentId);
      // What the environment builds from, marked the way the settings list
      // marks it. Read from the environment because that is where a checkout
      // is declared, but shown here, because an instance is the row a person
      // picks between and "which repo is this" is what they are asking. The
      // instance's own directory cannot answer it: that is a folder inside the
      // workspace, which a repository icon would misread.
      const repository = repositoryPath(environment?.configuration);
      // Somebody else's run. The execution plane allows one session per
      // instance — the second writer meets a 409 ENVIRONMENT_IN_USE — so
      // offering it would be offering a choice the next message refuses. Its
      // own topic's run is the opposite case: that conversation is the one
      // running, and taking its instance away mid-run is the last thing to do.
      const occupied = instance.inUse && !instance.inUseByThisTopic;
      // A build holds the very same lease — it is the exclusive writer while
      // it publishes — so it needs no rule of its own here, only its own word.
      // "Running" on an instance that is still being assembled would send
      // someone looking for the conversation that is using it.
      const preparing = instance.status === 'pending';
      // Nothing has been cloned or installed into it yet. Selectable all the
      // same: a build that failed is retried from the settings page, and a
      // conversation pointed at the instance is how someone gets back to it.
      const unbuilt = instance.status === 'error';

      return (
        <OptionRow
          active={instance.id === boundInstanceId}
          // Already this conversation's own instance: it stays selectable
          // however the lease reads, because "you cannot pick what you are
          // already using" is never the right thing to tell someone.
          disabled={(occupied || preparing) && instance.id !== boundInstanceId}
          icon={repository ? <Github size={16} /> : <Icon icon={INSTANCE_ICON} size={16} />}
          key={instance.id}
          label={instance.name}
          desc={
            <span className={styles.environmentRow}>
              {environment
                ? `${environment.name} · ${instance.workingDirectory}`
                : instance.workingDirectory}
            </span>
          }
          tag={
            preparing
              ? t('sandboxWorkspace.building')
              : unbuilt
                ? t('sandboxWorkspace.buildFailed')
                : instance.inUse
                  ? t('sandboxWorkspace.running')
                  : undefined
          }
          onClick={() => void select({ instanceId: instance.id, mode: 'persistent' })}
        />
      );
    };

    // The chip names what was chosen — an instance, or the temporary directory
    // once it has been picked on purpose — and otherwise the slot itself, the
    // same words the local chip shows before a folder is chosen. The default
    // is not a choice, so it does not get named as one.
    // A node rather than an icon component, because the repository mark is not
    // a lucide glyph and the chip has to be able to show it: the chip names the
    // instance the menu named, so a row that reads as a checkout cannot
    // collapse back into a generic window once the menu closes.
    const chipIcon = (() => {
      if (!current) {
        return value.mode === 'ephemeral' ? (
          <Icon icon={TimerIcon} size={14} />
        ) : (
          <Icon icon={FolderIcon} size={14} />
        );
      }
      if (currentBlocked) return <Icon icon={LockIcon} size={14} />;

      return repositoryPath(environmentById.get(current.environmentId)?.configuration) ? (
        <Github size={14} />
      ) : (
        <Icon icon={INSTANCE_ICON} size={14} />
      );
    })();

    const chipLabel = current
      ? current.name
      : value.mode === 'ephemeral'
        ? t('sandboxWorkspace.ephemeral')
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
            <span className={styles.headerTitle}>{t('sandboxWorkspace.pickerTitle')}</span>
            <Tooltip title={t('sandboxWorkspace.pickerInfoTooltip')}>
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
              <span>{t('sandboxWorkspace.manage')}</span>
            </button>
          )}
        </div>

        {current && currentBlocked && (
          <Text className={styles.blockedNotice}>
            {t('sandboxWorkspace.privateInstanceBlocked', { name: current.name })}
          </Text>
        )}

        {/* This conversation's own instance, held by another one. It stays
            bound — the lease may well be free again by the next message — but
            saying nothing would leave a 409 to do the explaining. */}
        {current && !currentBlocked && current.inUse && !current.inUseByThisTopic && (
          <Text className={styles.blockedNotice}>
            {t('sandboxWorkspace.instanceBusy', { name: current.name })}
          </Text>
        )}

        <Flexbox className={styles.temporary}>
          <OptionRow
            active={value.mode === 'ephemeral'}
            desc={t('sandboxWorkspace.ephemeralDesc')}
            icon={<Icon icon={TimerIcon} size={16} />}
            label={t('sandboxWorkspace.ephemeral')}
            onClick={() => void select({ mode: 'ephemeral' })}
          />
        </Flexbox>

        {!entitled && (
          // Persistence is part of a plan this account is not on. Offered
          // in the same list, in the same shape, so the row reads as one
          // more place files could go — and the tag says why it is not
          // simply selectable.
          <OptionRow
            desc={t('sandboxWorkspace.persistentUpsellDesc')}
            icon={<Icon icon={FolderClockIcon} size={16} />}
            label={t('sandboxWorkspace.persistentUpsell')}
            tag={t('pro', { ns: 'common' })}
            onClick={() => leaveTo(openSandboxWorkspaceUpsell)}
          />
        )}

        {entitled && (environmentsLoading || instancesLoading) && <EnvironmentSectionSkeleton />}

        {entitled && environmentError && (
          <Text className={styles.notice}>{t('sandboxWorkspace.environmentsUnavailable')}</Text>
        )}

        {entitled && hasNoInstances && (
          // Nothing to choose from yet. Both roads lead to the same page —
          // the row only changes which step it names, because "set up an
          // environment" reads as a dead end to someone who already has one.
          <OptionRow
            icon={<Icon icon={PlusIcon} size={16} />}
            desc={t(
              hasNoEnvironments
                ? 'sandboxWorkspace.setUpEnvironmentDesc'
                : 'sandboxWorkspace.noInstancesDesc',
            )}
            label={t(
              hasNoEnvironments
                ? 'sandboxWorkspace.setUpEnvironment'
                : 'sandboxWorkspace.noInstances',
            )}
            onClick={() => leaveTo(() => navigate('/settings/environments'))}
          />
        )}

        {entitled &&
          !inWorkspace &&
          selectableInstances.map((instance) => renderInstance(instance))}

        {entitled && inWorkspace && privatePool.length > 0 && (
          <>
            <div className={styles.groupLabel}>{t('sandboxWorkspace.privateGroup')}</div>
            {privatePool.map((instance) => renderInstance(instance))}
          </>
        )}

        {entitled && inWorkspace && workspacePool.length > 0 && (
          <>
            <div className={styles.groupLabel}>{t('sandboxWorkspace.workspaceGroup')}</div>
            {workspacePool.map((instance) => renderInstance(instance))}
          </>
        )}

        {/* Where the hidden ones went, and how to get one back — the device
            menu's enroll hint, in this menu's terms. One line however many
            were dropped; which ones is the settings page's job. */}
        {entitled && hiddenPrivateCount > 0 && (
          <Text className={styles.notice}>
            {t('sandboxWorkspace.publicAgentHint', { count: hiddenPrivateCount })}
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
        onOpenChange={setOpen}
      >
        <div>
          <Tooltip
            title={
              current && currentBlocked
                ? t('sandboxWorkspace.privateInstanceBlocked', { name: current.name })
                : undefined
            }
          >
            <div className={cx(workingDirectoryChipStyles.chip, currentBlocked && styles.blocked)}>
              {chipIcon}
              <span className={workingDirectoryChipStyles.label}>{chipLabel}</span>
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
