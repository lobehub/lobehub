/**
 * @vitest-environment happy-dom
 */
import { useForm } from '@lobehub/ui/form';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { schema as discordSchema } from '@/server/services/bot/platforms/discord/schema';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import agentZh from '../../../../locales/zh-CN/agent.json';
import agentEn from '../../../../packages/locales/src/default/agent';
import Body, { type ModuleControls } from './Body';
import { getChannelFormValues, mergeSettingsWithDefaults } from './formState';
import type { ChannelFormValues } from './index';

const state = vi.hoisted(() => ({
  copy: {} as Record<string, string>,
  featureFlags: {} as Record<string, unknown>,
}));

// Resolve real copy instead of echoing keys, so the test sees what a user would read.
vi.mock('react-i18next', () => ({
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
  useTranslation: () => ({ t: (key: string) => state.copy[key] ?? key }),
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (s: { featureFlags: Record<string, unknown> }) => unknown) =>
    selector({ featureFlags: state.featureFlags }),
}));

vi.mock('@/components/FormInput', () => ({
  FormInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  FormTextArea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
  FormPassword: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/components/InfoTooltip', () => ({
  default: ({ title }: { title?: string }) => <span aria-hidden="true" title={title} />,
}));

vi.mock('@/features/AgentChannel/const', () => ({ getPlatformIcon: () => null }));

vi.mock('@/services/agentBotProvider', () => ({
  agentBotProviderService: { wechatGetQrCode: vi.fn(), wechatPollQrStatus: vi.fn() },
}));

vi.mock('@/hooks/useAppOrigin', () => ({ useAppOrigin: () => 'https://example.test' }));

const platformDef = {
  documentation: {},
  id: 'discord',
  name: 'Discord',
  schema: discordSchema,
} as unknown as SerializedPlatformDefinition;

const ACCESS_IDS = ['access-identity', 'access-conversation', 'access-device'] as const;

/** Mounts the access tab the way the channel page does: a saved bot, merged with the defaults. */
const Harness = ({
  moduleControls,
  settings,
}: {
  moduleControls?: ModuleControls;
  settings?: Record<string, unknown>;
}) => {
  const form = useForm<ChannelFormValues>();
  const saved = mergeSettingsWithDefaults(discordSchema, settings ?? {});

  useEffect(() => {
    form.setValues(
      getChannelFormValues({ applicationId: '1', credentials: {}, settings: saved }) as never,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Body
      hasConfig
      activeTab="access"
      currentConfig={{ applicationId: '1', credentials: {}, settings: saved }}
      form={form}
      moduleControls={moduleControls}
      platformDef={platformDef}
    />
  );
};

const en = agentEn as Record<string, string>;
const zh = agentZh as Record<string, string>;

const controls = (overrides: Partial<ModuleControls> = {}): ModuleControls => ({
  dirty: [],
  ids: ACCESS_IDS,
  onDiscard: vi.fn(),
  onSave: vi.fn(),
  ...overrides,
});

describe('channel settings form: access tab', () => {
  it('splits access into owner identity, conversation and device blocks, each with a Save', () => {
    state.copy = zh;

    render(<Harness moduleControls={controls()} />);

    const titles = [
      zh['channel.access.section.identity'],
      zh['channel.access.section.conversation'],
      zh['channel.access.section.device'],
    ];
    for (const title of titles) expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: zh['channel.module.save'] })).toHaveLength(3);
  });

  it('keeps devices to the owner by default and hides the authorized list', () => {
    state.copy = en;

    render(<Harness />);

    const device = screen.getByRole('radiogroup', { name: en['channel.access.device.label'] });
    expect(within(device).getByRole('radio', { name: /Only me/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.queryByText(en['channel.access.device.list'])).not.toBeVisible();
  });

  it('shows the authorized list once devices are shared, and saves only the device block', () => {
    state.copy = en;
    const onSave = vi.fn();

    render(
      <Harness
        moduleControls={controls({ dirty: ['access-device'], onSave })}
        settings={{
          deviceAllowFrom: [{ id: 'friend-1', name: 'Ada' }],
          devicePolicy: 'allowlist',
          userId: 'owner-1',
        }}
      />,
    );

    expect(screen.getByText(en['channel.access.device.list'])).toBeVisible();
    // The list's add button derives its copy from the field label: a missing key shows raw.
    expect(screen.getByRole('button', { name: 'Add person' })).toBeVisible();
    expect(screen.getByDisplayValue('friend-1')).toBeInTheDocument();

    const enabled = screen
      .getAllByRole('button', { name: en['channel.module.save'] })
      .filter((button) => !(button as HTMLButtonElement).disabled);
    expect(enabled).toHaveLength(1);
    fireEvent.click(enabled[0]);
    expect(onSave).toHaveBeenCalledWith('access-device');
  });

  it('leaves devices usable in any channel by default and hides the channel list', () => {
    state.copy = en;

    render(<Harness />);

    const scope = screen.getByRole('radiogroup', {
      name: en['channel.access.device.channel.label'],
    });
    expect(
      within(scope).getByRole('radio', {
        name: new RegExp(en['channel.access.device.channel.any']),
      }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText(en['channel.access.device.channel.list'])).not.toBeVisible();
  });

  it('limits devices to listed channels and saves the choice with the device block', () => {
    state.copy = zh;
    const onSave = vi.fn();

    render(
      <Harness
        moduleControls={controls({ dirty: ['access-device'], onSave })}
        settings={{
          deviceChannelAllowFrom: [{ id: 'dev-channel', name: '#dev' }],
          deviceChannelPolicy: 'allowlist',
          userId: 'owner-1',
        }}
      />,
    );

    const scope = screen.getByRole('radiogroup', {
      name: zh['channel.access.device.channel.label'],
    });
    expect(
      within(scope).getByRole('radio', {
        name: new RegExp(zh['channel.access.device.channel.allowlist']),
      }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(zh['channel.access.device.channel.list'])).toBeVisible();
    // The list's add button derives its copy from the field label: a missing key shows raw.
    expect(
      screen.getByRole('button', { name: zh['channel.deviceChannelAllowFromAdd'] }),
    ).toBeVisible();
    expect(screen.getByDisplayValue('dev-channel')).toBeInTheDocument();

    const enabled = screen
      .getAllByRole('button', { name: zh['channel.module.save'] })
      .filter((button) => !(button as HTMLButtonElement).disabled);
    expect(enabled).toHaveLength(1);
    fireEvent.click(enabled[0]);
    expect(onSave).toHaveBeenCalledWith('access-device');
  });

  it('warns that nobody can use the devices until the owner ID is filled', () => {
    state.copy = en;

    render(<Harness />);

    expect(screen.getByText(en['channel.access.device.ownerMissing'])).toBeInTheDocument();
  });
});
