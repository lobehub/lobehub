'use client';

import { Flexbox, Icon, Popover } from '@lobehub/ui';
import { Skeleton, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  AppWindowMacIcon,
  ChevronDownIcon,
  FolderClockIcon,
  FolderIcon,
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
  footer: css`
    padding-block-start: 4px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  header: css`
    padding-block: 2px 6px;
    padding-inline: 8px;
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
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
  ({ entitled, onChange, topicId, value }) => {
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
    } = useSWR(entitled && open ? 'sandbox-environments' : null, () =>
      sandboxWorkspaceService.listEnvironments(),
    );

    const instances = data?.instances ?? [];
    const environments = environmentData?.environments ?? [];
    const current = instances.find((instance) => instance.id === boundInstanceId);
    // Only once the list has actually arrived: an undefined list is "not known
    // yet", not "none", and a list that FAILED is a third thing the menu names.
    const hasNoEnvironments = Boolean(environmentData) && environments.length === 0;

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

    // The chip names what was chosen — an instance, or the temporary directory
    // once it has been picked on purpose — and otherwise the slot itself, the
    // same words the local chip shows before a folder is chosen. The default
    // is not a choice, so it does not get named as one.
    const chip = current
      ? { icon: INSTANCE_ICON, label: current.name }
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
      <Flexbox gap={2} style={{ minWidth: 280 }}>
        <Text className={styles.header}>{t('workingDirectory.title', { ns: 'device' })}</Text>

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
          environments.map((environment) => (
            <Flexbox gap={2} key={environment.id}>
              <Text ellipsis className={styles.environment}>
                {environment.name}
              </Text>

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

              <OptionRow
                icon={<Icon icon={PlusIcon} size={16} />}
                label={t('sandboxWorkspace.newInstance')}
                onClick={() => createIn(environment.id)}
              />
            </Flexbox>
          ))}

        {entitled && (
          // Selecting an environment and shaping one are different jobs, so
          // this leaves rather than expands. Not gated on the list having
          // anything in it: an empty, unknown or failed list is exactly when
          // the way to the environments page is needed most.
          <Flexbox className={styles.footer}>
            <OptionRow
              icon={<Icon icon={SettingsIcon} size={16} />}
              label={t('sandboxWorkspace.manageEnvironments')}
              onClick={() => leaveTo(() => navigate('/settings/environments'))}
            />
          </Flexbox>
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
          <div className={workingDirectoryChipStyles.chip}>
            <Icon icon={chip.icon} size={14} />
            <span className={workingDirectoryChipStyles.label}>{chip.label}</span>
            <Icon icon={ChevronDownIcon} size={12} />
          </div>
        </div>
      </Popover>
    );
  },
);

SandboxInstancePicker.displayName = 'SandboxInstancePicker';

export default SandboxInstancePicker;
