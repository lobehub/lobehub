'use client';

import { Flexbox, Icon, Popover } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  AppWindowMacIcon,
  ChevronDownIcon,
  FolderOpenIcon,
  PlusIcon,
  SettingsIcon,
  TimerIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { sandboxWorkspaceService } from '@/services/sandboxWorkspace';

import { gitChipStyles } from './gitChipStyles';
import OptionRow from './OptionRow';

const styles = createStaticStyles(({ css }) => ({
  environment: css`
    padding-block: 6px 2px;
    padding-inline: 8px;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  header: css`
    padding-block: 2px 6px;
    padding-inline: 8px;
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  footer: css`
    padding-block-start: 4px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  modes: css`
    padding-block-end: 4px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  notice: css`
    padding-block: 8px;
    padding-inline: 8px;
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  row: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 8px;
    border-radius: 4px;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

/**
 * What a conversation runs in, as one answer rather than two settings.
 *
 * `ephemeral` keeps nothing: the box is discarded when the run ends. The two
 * persistent shapes differ only in whether an environment supplies the folder
 * and its installed state, so they belong on the same list as the throwaway one
 * — a user deciding where their files go is making a single choice.
 */
export interface SandboxSelection {
  /** Only meaningful with `persistent`; absent means the workspace root. */
  instanceId?: string;
  mode: 'ephemeral' | 'persistent';
}

interface SandboxInstancePickerProps {
  onChange: (selection: SandboxSelection) => Promise<void>;
  /**
   * Topic whose warm sandbox session serves the workspace file panel. Absent on
   * a conversation that has not been created yet — the calls below all take it
   * as an optimization, never as a scope, so they simply pay a cold start.
   */
  topicId?: string;
  /** What this conversation runs in today. */
  value: SandboxSelection;
}

/**
 * Which environment, and which instance of it, this conversation runs in.
 *
 * Environments come first because that is the choice with meaning: an
 * environment says what should be installed, an instance is one materialization
 * of it — a directory plus the state built into it. Two conversations that must
 * not overwrite each other take two instances of the same environment, which is
 * why instances are listed under their environment rather than beside it.
 *
 * An environment with no instance yet is not a dead end: creating one needs
 * nothing from the user that the environment does not already say, so the
 * "new instance" row asks for nothing and binds what it made.
 *
 * With no environment at all there is no choice to present, so the chip stops
 * being a menu and becomes the way to make the first one.
 *
 * Names, not sizes: sizes live in the snapshot store, which needs a live sandbox
 * session to answer, and a picker that takes seconds to open is a picker people
 * stop opening. The settings page is where sizes are worth the wait.
 */
/**
 * What each way of running looks like. Declared once because the chip and the
 * row it stands for are the same thing seen closed and open: a chip drawn from
 * its own icon drifts into naming one state while picturing another.
 */
const EPHEMERAL_ICON = TimerIcon;
const ROOT_ICON = FolderOpenIcon;
const INSTANCE_ICON = AppWindowMacIcon;

const SandboxInstancePicker = memo<SandboxInstancePickerProps>(({ onChange, topicId, value }) => {
  const boundInstanceId = value.mode === 'persistent' ? value.instanceId : undefined;
  // The slot's own name comes from the device namespace on purpose: the local
  // picker and this one are the same slot, and a second string meaning
  // "working directory" would be one more pair to keep in step.
  const { t } = useTranslation(['chat', 'device']);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<string | undefined>();
  const navigate = useWorkspaceAwareNavigate();

  // Also fetched while CLOSED whenever an instance is bound, because the chip
  // names it by looking it up in this list: gating the list on `open` alone
  // leaves the closed chip with nothing to look up, so a topic that has chosen
  // an instance still reads "pick one" until the menu happens to be open.
  const { data, mutate } = useSWR(
    open || boundInstanceId ? ['sandbox-instances', topicId] : null,
    () => sandboxWorkspaceService.listInstances({ topicId, withSizes: false }),
    { revalidateOnFocus: false },
  );
  // Not gated on `open`, unlike the instances above: this one decides what the
  // chip DOES, and a decision made on the click cannot wait for a fetch started
  // by it. The query is answered from the database alone, and the whole section
  // is already behind the lab flag, a sandbox target and an entitlement.
  const { data: environmentData, error: environmentError } = useSWR('sandbox-environments', () =>
    sandboxWorkspaceService.listEnvironments(),
  );

  const instances = data?.instances ?? [];
  const environments = environmentData?.environments ?? [];
  const current = instances.find((instance) => instance.id === boundInstanceId);

  const chip =
    value.mode === 'ephemeral'
      ? { icon: EPHEMERAL_ICON, label: t('sandboxWorkspace.ephemeral') }
      : current
        ? { icon: INSTANCE_ICON, label: current.name }
        : { icon: ROOT_ICON, label: t('sandboxWorkspace.root') };

  // Only once the list has actually arrived. An undefined list is "not known
  // yet", not "none", and sending someone to settings on a pending fetch would
  // take them away from a menu that was about to have their environments in it.
  //
  // A list that FAILED is a third thing again, and the one worth naming: left
  // to fall through it renders as a menu with no environments in it, which is
  // exactly what someone who has none sees. The menu says which it is.
  const hasNoEnvironments = Boolean(environmentData) && environments.length === 0;

  const select = async (selection: SandboxSelection) => {
    setOpen(false);
    await onChange(selection);
  };

  const createIn = async (environmentId: string) => {
    setCreating(environmentId);
    try {
      const created = await sandboxWorkspaceService.createInstanceForEnvironment({ environmentId });
      await mutate();
      await select({ instanceId: created.id, mode: 'persistent' });
    } finally {
      setCreating(undefined);
    }
  };

  // Nothing to choose between, so the chip is not a menu: it is the way to make
  // the first environment. A popover whose only row says "go to settings" is a
  // step that exists only to be clicked through.
  if (hasNoEnvironments) {
    return (
      <div className={gitChipStyles.prTrigger} onClick={() => navigate('/settings/environments')}>
        <Icon icon={PlusIcon} size={14} />
        <Text ellipsis style={{ maxWidth: 160 }}>
          {t('sandboxWorkspace.setUpEnvironment')}
        </Text>
      </div>
    );
  }

  return (
    <Popover
      arrow={false}
      open={open}
      placement={'topLeft'}
      trigger={'click'}
      content={
        <Flexbox gap={2} style={{ minWidth: 280 }}>
          <Text className={styles.header}>{t('workingDirectory.title', { ns: 'device' })}</Text>

          {/* The two ways to run without an environment, above the ones with.
              Both belong on this list because the user is making one choice —
              where these files go — and the throwaway box is one of the
              answers. Leaving it unnamed is what made the mode invisible: a
              conversation was ephemeral until it happened to touch this menu,
              and could never be told so or sent back. */}
          <Flexbox className={styles.modes} gap={2}>
            <OptionRow
              active={value.mode === 'ephemeral'}
              desc={t('sandboxWorkspace.ephemeralDesc')}
              icon={<Icon icon={EPHEMERAL_ICON} size={16} />}
              label={t('sandboxWorkspace.ephemeral')}
              onClick={() => void select({ mode: 'ephemeral' })}
            />
            <OptionRow
              active={value.mode === 'persistent' && !value.instanceId}
              desc={t('sandboxWorkspace.rootDesc')}
              icon={<Icon icon={ROOT_ICON} size={16} />}
              label={t('sandboxWorkspace.root')}
              onClick={() => void select({ mode: 'persistent' })}
            />
          </Flexbox>

          {environmentError && (
            <Text className={styles.notice}>{t('sandboxWorkspace.environmentsUnavailable')}</Text>
          )}

          {environments.map((environment) => (
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
                    tag={instance.stale ? t('sandboxWorkspace.instanceStale') : undefined}
                    onClick={() => void select({ instanceId: instance.id, mode: 'persistent' })}
                  />
                ))}

              <OptionRow
                icon={<Icon icon={PlusIcon} size={16} />}
                label={
                  creating === environment.id
                    ? t('sandboxWorkspace.creatingInstance')
                    : t('sandboxWorkspace.newInstance')
                }
                onClick={() => {
                  if (!creating) void createIn(environment.id);
                }}
              />
            </Flexbox>
          ))}
          {/* Selecting an environment and shaping one are different jobs, so
              this leaves rather than expands — and it is the only way out of a
              menu whose list is empty or could not be read. */}
          <Flexbox className={styles.footer}>
            <OptionRow
              icon={<Icon icon={SettingsIcon} size={16} />}
              label={t('sandboxWorkspace.manageEnvironments')}
              onClick={() => {
                setOpen(false);
                navigate('/settings/environments');
              }}
            />
          </Flexbox>
        </Flexbox>
      }
      onOpenChange={setOpen}
    >
      <div className={gitChipStyles.prTrigger}>
        <Icon icon={chip.icon} size={14} />
        <Text ellipsis style={{ maxWidth: 160 }}>
          {chip.label}
        </Text>
        <Icon icon={ChevronDownIcon} size={12} />
      </div>
    </Popover>
  );
});

SandboxInstancePicker.displayName = 'SandboxInstancePicker';

export default SandboxInstancePicker;
