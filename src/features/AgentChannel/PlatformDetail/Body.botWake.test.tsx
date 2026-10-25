/**
 * @vitest-environment happy-dom
 */
import { useForm } from '@lobehub/ui/form';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { schema as discordSchema } from '@/server/services/bot/platforms/discord/schema';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import agentZh from '../../../../locales/zh-CN/agent.json';
import agentEn from '../../../../packages/locales/src/default/agent';
import Body from './Body';
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

/** Mounts the form the way the channel page does: a saved bot, its settings merged with the defaults. */
const Harness = ({ settings }: { settings?: Record<string, unknown> }) => {
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
      currentConfig={{ applicationId: '1', credentials: {}, settings: saved }}
      form={form}
      platformDef={platformDef}
    />
  );
};

const en = agentEn as Record<string, string>;
const zh = agentZh as Record<string, string>;

describe('channel settings form: bot-wake options', () => {
  it('shows none of them until the rollout reaches the user', () => {
    state.copy = en;
    state.featureFlags = {};

    render(<Harness />);

    // The form is up (an ordinary advanced setting renders) ...
    expect(screen.getByText(en['channel.watchKeywords'])).toBeInTheDocument();
    // ... and no bot-wake option leaks out.
    expect(screen.queryByText(en['channel.botWakeEnabled'])).not.toBeInTheDocument();
    expect(screen.queryByText(en['channel.botWakeMode'])).not.toBeInTheDocument();
  });

  it('also hides them while the flags are explicitly off', () => {
    state.copy = en;
    state.featureFlags = { enableBotWake: false };

    render(<Harness />);

    expect(screen.queryByText(en['channel.botWakeEnabled'])).not.toBeInTheDocument();
  });

  it('shows only the master switch once released, and the rest after it is turned on', async () => {
    state.copy = en;
    state.featureFlags = { enableBotWake: true };

    render(<Harness />);

    expect(screen.getByText(en['channel.botWakeEnabled'])).toBeInTheDocument();
    expect(screen.queryByText(en['channel.botWakeMode'])).not.toBeInTheDocument();
    expect(screen.queryByText(en['channel.botWakeClassifierMode'])).not.toBeInTheDocument();
    expect(screen.queryByText(en['channel.botWakeSchedulerMode'])).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: en['channel.botWakeEnabled'] }));

    await waitFor(() => expect(screen.getByText(en['channel.botWakeMode'])).toBeInTheDocument());
    expect(screen.getByText(en['channel.botWakeScope'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeAllowChannels'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeClassifierMode'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeCustomInstructions'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeSchedulerMode'])).toBeInTheDocument();
    // Batching timings stay out of the way until batching is on.
    expect(screen.queryByText(en['channel.botWakeCollectSeconds'])).not.toBeInTheDocument();
  });

  it('opens straight onto the options for a bot that already has them on', () => {
    state.copy = en;
    state.featureFlags = { enableBotWake: true };

    render(<Harness settings={{ botWakeEnabled: true, botWakeSchedulerMode: 'enforce' }} />);

    expect(screen.getByText(en['channel.botWakeMode'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeCollectSeconds'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeCooldownSeconds'])).toBeInTheDocument();
  });

  it('reads in Chinese for a Chinese user', () => {
    state.copy = zh;
    state.featureFlags = { enableBotWake: true };

    render(<Harness settings={{ botWakeEnabled: true }} />);

    expect(screen.getByText('按规则判断未定向消息')).toBeInTheDocument();
    expect(screen.getByText('跟进窗口（秒）')).toBeInTheDocument();
    expect(screen.getByText('自定义说明')).toBeInTheDocument();
    expect(screen.queryByText('channel.botWakeMode')).not.toBeInTheDocument();
  });
});
