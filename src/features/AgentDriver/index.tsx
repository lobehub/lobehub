'use client';

import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MODEL } from '@lobechat/const';
import { confirmModal, cssVar, Flexbox, Icon, Text, toast } from '@lobehub/ui';
import { SparklesIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CONNECTABLE_PROVIDERS, getConnectableProvider } from '@/features/ConnectAgent/providers';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { type DriverTarget, planDriverRollback, planDriverSwitch } from './switchPlan';

const HARNESS = 'lobehub';

interface AgentDriverSelectProps {
  agentId: string;
  /** False when something else owns the choice, e.g. an agent bound to a device. */
  canEdit: boolean;
}

interface DriverTileProps {
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onChoose: () => void;
  selected: boolean;
}

/** One driver as a tile; the chosen one is outlined, and one that cannot be picked is dimmed. */
const DriverTile = memo<DriverTileProps>(({ disabled, icon, label, onChoose, selected }) => (
  <Flexbox
    horizontal
    align={'center'}
    aria-checked={selected}
    gap={10}
    role={'radio'}
    tabIndex={disabled ? -1 : 0}
    style={{
      background: selected ? cssVar.colorFillTertiary : 'transparent',
      border: `1px solid ${selected ? cssVar.colorText : cssVar.colorBorderSecondary}`,
      borderRadius: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      padding: '10px 12px',
    }}
    onClick={() => {
      if (!disabled) onChoose();
    }}
    onKeyDown={(event) => {
      if (event.key === 'Enter' && !disabled) onChoose();
    }}
  >
    {icon}
    <Text ellipsis style={{ fontWeight: selected ? 600 : 400 }}>
      {label}
    </Text>
  </Flexbox>
));

DriverTile.displayName = 'DriverTile';

/**
 * Which engine runs this agent: LobeHub Harness, where the model, tools and instruction are
 * all chosen on this agent, or a heterogeneous agent (Claude Code, Codex, …) that brings its
 * own runtime. It is one field whose value is the current driver — choosing another asks
 * first, because what can be configured below changes with it.
 *
 * Remote platform drivers (OpenClaw, Hermes) are listed but cannot be picked here: they only
 * exist bound to a device, and picking the device is part of creating them.
 */
const AgentDriverSelect = memo<AgentDriverSelectProps>(({ agentId, canEdit }) => {
  const { t } = useTranslation('setting');
  const heterogeneousProvider = useAgentStore(
    (s) => agentSelectors.getAgentConfigById(agentId)(s)?.agencyConfig?.heterogeneousProvider,
  );
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const defaults = useUserStore(settingsSelectors.defaultAgentConfig);

  const harnessName = t('settingAgent.driver.harness');
  const current = heterogeneousProvider?.type ?? HARNESS;

  const switchTo = (target: DriverTarget, name: string) => {
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      okText: t('settingAgent.driver.switchOk'),
      title: t('settingAgent.driver.switchTitle', { name }),
      content: (
        <Flexbox gap={8}>
          <Text>{t('settingAgent.driver.switchKeepTopics', { name })}</Text>
          {!heterogeneousProvider && target.kind === 'hetero' && (
            <Text type={'warning'}>{t('settingAgent.driver.switchLosesPrompt', { name })}</Text>
          )}
          {target.kind === 'harness' && <Text>{t('settingAgent.driver.switchBackHarness')}</Text>}
        </Flexbox>
      ),
      onOk: async () => {
        const plan = planDriverSwitch({
          currentlyHeterogeneous: !!heterogeneousProvider,
          defaults: {
            model: defaults.model ?? DEFAULT_MODEL,
            provider: defaults.provider ?? DEFAULT_PROVIDER,
          },
          target,
        });

        // What the agent is now, kept so a half-finished switch can be undone.
        const before = agentSelectors.getAgentConfigById(agentId)(useAgentStore.getState());
        const previous = {
          heterogeneousProvider: before?.agencyConfig?.heterogeneousProvider,
          provider: before?.provider,
        };

        try {
          // Sequential on purpose: the second write must merge into the cleared block.
          for (const patch of plan) await updateAgentConfigById(agentId, patch);
          toast.success(t('settingAgent.driver.switched', { name }));
        } catch {
          // Switching between two external drivers is clear-then-write. If the write fails after
          // the clear, put the previous driver back rather than leave the agent on LobeHub with a
          // stale provider stamp.
          if (plan.length > 1 && previous.heterogeneousProvider) {
            try {
              await updateAgentConfigById(agentId, planDriverRollback(previous));
            } catch {
              // The failure toast below still tells the person the switch did not happen.
            }
          }
          toast.error(t('settingAgent.driver.switchFailed'));
        }
      },
    });
  };

  const choose = (value: string) => {
    if (value === current) return;

    if (value === HARNESS) return switchTo({ kind: 'harness' }, harnessName);

    const provider = getConnectableProvider(value as never);
    if (!provider || provider.kind === 'platform') return;
    switchTo({ command: provider.command, kind: 'hetero', type: provider.type }, provider.title);
  };

  const grid = (children: ReactNode) => (
    <div
      role={'radiogroup'}
      style={{
        display: 'grid',
        gap: 8,
        gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
      }}
    >
      {children}
    </div>
  );

  const providerTile = (provider: (typeof CONNECTABLE_PROVIDERS)[number]) => (
    <DriverTile
      disabled={!canEdit || (provider.kind === 'platform' && provider.type !== current)}
      icon={<provider.brand.Avatar size={20} />}
      key={provider.type}
      label={provider.title}
      selected={provider.type === current}
      onChoose={() => choose(provider.type)}
    />
  );

  const group = (title: string, children: ReactNode) => (
    <Flexbox gap={8}>
      <Text fontSize={12} type={'secondary'}>
        {title}
      </Text>
      {children}
    </Flexbox>
  );

  // Every option is in view, so the choice is a look rather than a lookup.
  return (
    <Flexbox gap={16}>
      {group(
        t('settingAgent.driver.groupHarness'),
        grid(
          <DriverTile
            disabled={!canEdit}
            icon={<Icon icon={SparklesIcon} size={20} />}
            label={harnessName}
            selected={current === HARNESS}
            onChoose={() => choose(HARNESS)}
          />,
        ),
      )}
      {group(
        t('settingAgent.driver.groupCli'),
        grid(
          CONNECTABLE_PROVIDERS.filter((p) => p.kind !== 'platform').map((p) => providerTile(p)),
        ),
      )}
      {group(
        t('settingAgent.driver.groupRemote'),
        grid(
          CONNECTABLE_PROVIDERS.filter((p) => p.kind === 'platform').map((p) => providerTile(p)),
        ),
      )}
    </Flexbox>
  );
});

AgentDriverSelect.displayName = 'AgentDriverSelect';

export default AgentDriverSelect;
