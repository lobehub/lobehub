/**
 * @vitest-environment happy-dom
 */
import { useForm } from '@lobehub/ui/form';
import { render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { schema as discordSchema } from '@/server/services/bot/platforms/discord/schema';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import agentZh from '../../../../locales/zh-CN/agent.json';
import agentEn from '../../../../packages/locales/src/default/agent';
import Body from './Body';
import {
  getChannelFormValues,
  isWakeMasterReleased,
  mergeSettingsWithDefaults,
  withWakeMasterOn,
} from './formState';
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

/** Mounts the form the way the channel page does: a saved bot, its settings merged with the defaults. */
const Harness = ({ settings }: { settings?: Record<string, unknown> }) => {
  const form = useForm<ChannelFormValues>();
  // The page switches the master on for a user the options are released to.
  const saved = withWakeMasterOn(
    mergeSettingsWithDefaults(discordSchema, settings ?? {}),
    isWakeMasterReleased(discordSchema, state.featureFlags),
  );

  useEffect(() => {
    form.setValues(
      getChannelFormValues({ applicationId: '1', credentials: {}, settings: saved }) as never,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Body
      hasConfig
      activeTab="wake"
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
    expect(screen.queryByText(en['channel.botWakeScope'])).not.toBeInTheDocument();
    expect(screen.queryByText(en['channel.wake.intro'])).not.toBeInTheDocument();
  });

  it('also hides them while the flags are explicitly off', () => {
    state.copy = en;
    state.featureFlags = { enableBotWake: false };

    render(<Harness />);

    expect(screen.queryByText(en['channel.botWakeScope'])).not.toBeInTheDocument();
  });

  it('has no master switch: the rules show straight away once released, the timings after batching is on', () => {
    state.copy = en;
    state.featureFlags = { enableBotWake: true };

    render(<Harness />);

    expect(screen.queryByText(en['channel.botWakeEnabled'])).not.toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeScope'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeAllowChannels'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeCustomInstructions'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeSchedulerMode'])).toBeInTheDocument();
    // Batching timings stay out of the way until batching is on.
    expect(screen.queryByText(en['channel.botWakeCollectSeconds'])).not.toBeInTheDocument();
  });

  it('explains what the options do, since there is no switch to read', () => {
    state.copy = en;
    state.featureFlags = { enableBotWake: true };

    render(<Harness />);

    expect(screen.getByText(en['channel.wake.intro'])).toBeInTheDocument();
  });

  it('opens straight onto the options for a bot that already has them on', () => {
    state.copy = en;
    state.featureFlags = { enableBotWake: true };

    render(<Harness settings={{ botWakeEnabled: true, botWakeSchedulerMode: 'enforce' }} />);

    expect(screen.getByText(en['channel.botWakeScope'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeCollectSeconds'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeCooldownSeconds'])).toBeInTheDocument();
  });

  it('reads in Chinese for a Chinese user', () => {
    state.copy = zh;
    state.featureFlags = { enableBotWake: true };

    render(<Harness settings={{ botWakeEnabled: true }} />);

    expect(screen.getByText('跟进窗口（秒）')).toBeInTheDocument();
    expect(screen.getByText('自定义说明')).toBeInTheDocument();
    expect(screen.queryByText('channel.botWakeScope')).not.toBeInTheDocument();
  });

  it('offers no "Rules" or "Addressed-to-bot check" mode to pick: they always enforce', () => {
    state.copy = en;
    state.featureFlags = { enableBotWake: true };

    render(<Harness settings={{ botWakeEnabled: true }} />);

    expect(screen.queryByText('Rules')).not.toBeInTheDocument();
    expect(screen.queryByText('Addressed-to-bot check')).not.toBeInTheDocument();
    expect(screen.queryByText('Record only')).not.toBeInTheDocument();
  });

  it('groups the options into keywords, channels, pace and judgement, each under its own title', () => {
    state.copy = en;
    state.featureFlags = { enableBotWake: true };

    render(<Harness settings={{ botWakeEnabled: true }} />);

    const titles = ['keywords', 'channels', 'pace', 'judgement'].map((key) =>
      screen.getByText(en[`channel.wake.section.${key}`]),
    );
    // Titles come in page order.
    for (let i = 1; i < titles.length; i++) {
      expect(
        titles[i - 1].compareDocumentPosition(titles[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    // Each option sits in its own section: the list of channels after the "Channels" title and
    // before "Pace", the follow-up window after "Pace".
    const position = (node: HTMLElement) => (a: HTMLElement) =>
      node.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING;
    const channelsTitle = screen.getByText(en['channel.wake.section.channels']);
    const paceTitle = screen.getByText(en['channel.wake.section.pace']);
    expect(
      position(channelsTitle)(screen.getByText(en['channel.botWakeAllowChannels'])),
    ).toBeTruthy();
    expect(position(screen.getByText(en['channel.botWakeAllowChannels']))(paceTitle)).toBeTruthy();
    expect(position(paceTitle)(screen.getByText(en['channel.botWakeWindowSeconds']))).toBeTruthy();
  });

  it('gives the custom instructions a text area of their own, large enough to write a prompt', () => {
    state.copy = en;
    state.featureFlags = { enableBotWake: true };

    const { container } = render(<Harness settings={{ botWakeEnabled: true }} />);

    const area = container.querySelector('textarea')!;
    expect(area).toBeInTheDocument();
    expect(Number(area.getAttribute('rows'))).toBeGreaterThanOrEqual(8);
    expect(Number(area.getAttribute('maxlength'))).toBeGreaterThanOrEqual(2000);
    // The only multi-line field: the others stay single-line.
    expect(container.querySelectorAll('textarea')).toHaveLength(1);
  });

  it('shows the saved instructions in the text area', () => {
    state.copy = en;
    state.featureFlags = { enableBotWake: true };

    const { container } = render(
      <Harness
        settings={{
          botWakeCustomInstructions: 'Only answer billing questions.\nNever joke.',
          botWakeEnabled: true,
        }}
      />,
    );

    expect(container.querySelector('textarea')).toHaveValue(
      'Only answer billing questions.\nNever joke.',
    );
  });
});
