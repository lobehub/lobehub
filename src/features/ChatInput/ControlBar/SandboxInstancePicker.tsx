'use client';

import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { ActionIcon, Skeleton, Text } from '@lobehub/ui/base-ui';
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
import { openCreateInstanceModal } from '@/features/EnvironmentManager/CreateInstanceModal';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { sandboxWorkspaceService } from '@/services/sandboxWorkspace';

import OptionRow from './OptionRow';
import type { SandboxSelection } from './useSandboxMode';
import { workingDirectoryChipStyles } from './workingDirectoryChipStyles';

export type { SandboxSelection } from './useSandboxMode';

const styles = createStaticStyles(({ css }) => ({
  environment: css`
    padding-block: 6px 2px;
    padding-inline: 8px;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  /**
   * The caption and its one action on a single line. Making a copy is a
   * property of the environment, so it belongs beside its name — as a whole
   * row it cost one line per environment, and a menu of four spent four lines
   * saying "New instance".
   */
  environmentRow: css`
    padding-block: 6px 2px;
    padding-inline: 8px 4px;
  `,
  /** The pool caption, in the execution-target menu's own shape. */
  groupLabel: css`
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
 * The shape the environment section is about to take: a group caption over a
 * row the size of an instance. Without it the section is simply absent while
 * the list loads and then snaps into either a list or a "create one" row — and
 * an empty gap where a choice belongs reads as "there is nothing here", which
 * is the one thing it does not yet know.
 */
const EnvironmentSectionSkeleton = memo(() => (
  <Flexbox gap={2}>
    <Skeleton.Text className={styles.environment} rows={1} style={{ width: 96 }} />
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
 * to it. Below it, each environment and its instances; an instance is a folder
 * plus everything installed into it, which is why they are listed under their
 * environment rather than beside it, and why an environment with none still
 * gets a row that makes one.
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
    const { data, mutate } = useSWR(
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

    // Counted on what is left after that filter, not on the raw list. An agent
    // whose only environments are private would otherwise render neither a
    // choice nor the prompt to make one — the exact hole the device menu
    // documents at its own empty-state accounting.
    // Only once the list has actually arrived: an undefined list is "not known
    // yet", not "none", and a list that FAILED is a third thing the menu names.
    const hasNoEnvironments = Boolean(environmentData) && selectable.length === 0;

    const select = async (selection: SandboxSelection) => {
      setOpen(false);
      await onChange(selection);
    };

    const leaveTo = (action: () => void) => {
      setOpen(false);
      action();
    };

    // The same dialog the settings page opens, so the instance is named and
    // given its directory here too rather than conjured with a derived name.
    // Bound to the conversation as soon as it exists — that is what asking for
    // it from the composer was for.
    const createIn = (environmentId: string) =>
      leaveTo(() =>
        openCreateInstanceModal({
          environmentId,
          onCreated: (created) => {
            void mutate();
            void onChange({ instanceId: created.id, mode: 'persistent' });
          },
        }),
      );

    const renderEnvironment = (environment: (typeof selectable)[number]) => (
      <Flexbox gap={2} key={environment.id}>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.environmentRow}
          gap={4}
          justify={'space-between'}
        >
          <Text ellipsis className={styles.environment} style={{ padding: 0 }}>
            {environment.name}
          </Text>
          <ActionIcon
            icon={PlusIcon}
            size={'small'}
            title={t('sandboxWorkspace.newInstance')}
            onClick={() => createIn(environment.id)}
          />
        </Flexbox>

        {instances
          .filter((instance) => instance.environmentId === environment.id)
          .map((instance) => (
            <OptionRow
              active={instance.id === boundInstanceId}
              desc={instance.workingDirectory}
              icon={<Icon icon={INSTANCE_ICON} size={16} />}
              key={instance.id}
              label={instance.name}
              onClick={() => void select({ instanceId: instance.id, mode: 'persistent' })}
            />
          ))}
      </Flexbox>
    );

    // The chip names what was chosen — an instance, or the temporary directory
    // once it has been picked on purpose — and otherwise the slot itself, the
    // same words the local chip shows before a folder is chosen. The default
    // is not a choice, so it does not get named as one.
    const chip = current
      ? { icon: currentBlocked ? LockIcon : INSTANCE_ICON, label: current.name }
      : value.mode === 'ephemeral'
        ? { icon: TimerIcon, label: t('sandboxWorkspace.ephemeral') }
        : { icon: FolderIcon, label: t('workingDirectory.title', { ns: 'device' }) };

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

        {entitled && environmentsLoading && <EnvironmentSectionSkeleton />}

        {entitled && environmentError && (
          <Text className={styles.notice}>{t('sandboxWorkspace.environmentsUnavailable')}</Text>
        )}

        {entitled && hasNoEnvironments && (
          // Nothing to choose from yet, so the row is the way to make one.
          <OptionRow
            desc={t('sandboxWorkspace.setUpEnvironmentDesc')}
            icon={<Icon icon={PlusIcon} size={16} />}
            label={t('sandboxWorkspace.setUpEnvironment')}
            onClick={() => leaveTo(() => navigate('/settings/environments'))}
          />
        )}

        {entitled &&
          !inWorkspace &&
          selectable.map((environment) => renderEnvironment(environment))}

        {entitled && inWorkspace && privatePool.length > 0 && (
          <>
            <div className={styles.groupLabel}>{t('sandboxWorkspace.privateGroup')}</div>
            {privatePool.map((environment) => renderEnvironment(environment))}
          </>
        )}

        {entitled && inWorkspace && workspacePool.length > 0 && (
          <>
            <div className={styles.groupLabel}>{t('sandboxWorkspace.workspaceGroup')}</div>
            {workspacePool.map((environment) => renderEnvironment(environment))}
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
              <Icon icon={chip.icon} size={14} />
              <span className={workingDirectoryChipStyles.label}>{chip.label}</span>
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
