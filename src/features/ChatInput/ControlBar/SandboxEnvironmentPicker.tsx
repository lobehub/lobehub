'use client';

import { Button, Flexbox, Icon, Popover, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, CircleSlashIcon, PackageIcon, SettingsIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { environmentService } from '@/services/environment';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import OptionRow from './OptionRow';
import { environmentChipState, pickableEnvironments } from './sandboxEnvironmentOptions';
import type { SandboxSelection } from './useSandboxPlacement';
import { workingDirectoryChipStyles } from './workingDirectoryChipStyles';

const styles = stylex.create({
  header: {
    alignItems: 'center',
    display: 'flex',
    gap: 6,
    justifyContent: 'space-between',
    paddingBlock: 4,
  },
  headerTitle: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    fontWeight: 500,
  },
  hint: {
    color: cssVar.colorTextDescription,
    fontSize: 11,
    paddingBlockEnd: 4,
  },
  list: {
    maxHeight: 280,
    overflowY: 'auto',
  },
  manageButton: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderStyle: 'none',
    color: { 'default': cssVar.colorTextQuaternary, ':hover': cssVar.colorPrimary },
    cursor: 'pointer',
    display: 'flex',
    fontSize: 11,
    gap: 3,
    padding: 0,
    transition: 'color 0.2s',
  },
  // StyleX longhands outrank the row's own emotion padding.
  option: {
    paddingInline: 0,
  },
});

const optionClassName = stylex.props(styles.option).className;

interface SandboxEnvironmentPickerProps {
  onChange: (selection: SandboxSelection) => Promise<void>;
  /** Where this conversation works today, and what it is initialized from. */
  value: SandboxSelection;
}

/**
 * Which code environment a cloud-sandbox conversation starts from — beside the
 * working-directory chip, and independent of it. An environment is a one-time
 * initializer: its repository is cloned and its setup run in the working
 * directory before the first command, once per temporary sandbox and once for
 * a folder on the drive. A folder that already holds files is left as it is.
 *
 * Picking here changes only the environment; the folder stays where it is.
 */
const SandboxEnvironmentPicker = memo<SandboxEnvironmentPickerProps>(({ onChange, value }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const navigate = useWorkspaceAwareNavigate();
  const workspaceId = useActiveWorkspaceId();

  const { data, error, mutate } = useSWR(['sandbox-environment-chip', workspaceId ?? ''], () =>
    environmentService.listEnvironments(),
  );
  const sharedAgent = useAgentStore(
    (s) => !!workspaceId && agentSelectors.currentAgentVisibility(s) === 'public',
  );
  const environments = pickableEnvironments(data?.environments ?? [], sharedAgent);
  const current = environments.find((environment) => environment.id === value.environmentId);
  // Picked once but no longer readable — deleted, or unpublished by its owner
  // — is said rather than hidden; a list that has not loaded says nothing.
  const state = environmentChipState({
    current,
    environmentId: value.environmentId,
    failed: !!error,
    loaded: !!data,
  });

  const select = async (environmentId: string | undefined) => {
    setOpen(false);
    try {
      // A legacy copy runs what its build made and is never initialized, so
      // picking an environment leaves it for the folder it lives in.
      await onChange({ ...value, environmentId, instanceId: undefined });
    } catch {
      // The topic kept its environment; said rather than left looking changed.
      toast.error(t('sandboxEnvironment.saveFailed'));
    }
  };

  const content = (
    <Flexbox gap={2} style={{ maxWidth: 360, minWidth: 280 }}>
      <div {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.headerTitle)}>{t('sandboxEnvironment.title')}</span>
        <button
          {...stylex.props(styles.manageButton)}
          type={'button'}
          onClick={() => {
            setOpen(false);
            navigate('/settings/environments');
          }}
        >
          <Icon icon={SettingsIcon} size={11} />
          <span>{t('sandboxDrive.manageEnvironments')}</span>
        </button>
      </div>
      <Text className={stylex.props(styles.hint).className}>{t('sandboxEnvironment.hint')}</Text>

      <OptionRow
        active={!value.environmentId}
        className={optionClassName}
        desc={t('sandboxEnvironment.noneDesc')}
        icon={<Icon icon={CircleSlashIcon} size={16} />}
        label={t('sandboxEnvironment.none')}
        onClick={() => void select(undefined)}
      />
      <div {...stylex.props(styles.list)}>
        {environments.map((environment) => (
          <OptionRow
            active={environment.id === value.environmentId}
            className={optionClassName}
            desc={environment.description || undefined}
            icon={<Icon icon={PackageIcon} size={16} />}
            key={environment.id}
            label={environment.name}
            onClick={() => void select(environment.id)}
          />
        ))}
      </div>
      {data && environments.length === 0 && (
        <Text className={stylex.props(styles.hint).className}>{t('sandboxEnvironment.empty')}</Text>
      )}
      {!data && error && (
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Text className={stylex.props(styles.hint).className} type={'danger'}>
            {t('sandboxEnvironment.loadFailed')}
          </Text>
          <Button onClick={() => void mutate()}>{t('sandboxEnvironment.retry')}</Button>
        </Flexbox>
      )}
    </Flexbox>
  );

  const label =
    state.kind === 'picked'
      ? state.name
      : state.kind === 'missing'
        ? t('sandboxEnvironment.missing')
        : state.kind === 'loading'
          ? t('sandboxEnvironment.loading')
          : state.kind === 'loadFailed'
            ? t('sandboxEnvironment.loadFailed')
            : t('sandboxEnvironment.none');

  // A plain div between the popover and the chip, as the device picker has:
  // the popover merges trigger props into its direct child.
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
        <div className={workingDirectoryChipStyles.chip} data-testid={'sandbox-environment-chip'}>
          <Icon icon={value.environmentId ? PackageIcon : CircleSlashIcon} size={14} />
          <span className={workingDirectoryChipStyles.label}>{label}</span>
          <Icon icon={ChevronDownIcon} size={12} />
        </div>
      </div>
    </Popover>
  );
});

SandboxEnvironmentPicker.displayName = 'SandboxEnvironmentPicker';

export default SandboxEnvironmentPicker;
