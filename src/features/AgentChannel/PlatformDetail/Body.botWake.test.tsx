/**
 * @vitest-environment happy-dom
 */
import { useForm } from '@lobehub/ui/form';
import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { flattenBotWakeSettings } from '@/server/services/agentSignal/scenarios/botWake/config';
import { schema as discordSchema } from '@/server/services/bot/platforms/discord/schema';
import { sharedSchema as feishuSchema } from '@/server/services/bot/platforms/feishu/definitions/schema';
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

/** The custom-instructions and duties text areas, told apart by their placeholders. */
const textAreaWith = (container: HTMLElement, placeholderKey: string) =>
  container.querySelector<HTMLTextAreaElement>(
    `textarea[placeholder="${CSS.escape(agentEn[placeholderKey as keyof typeof agentEn] as string)}"]`,
  );
const instructionsArea = (container: HTMLElement) =>
  textAreaWith(container, 'channel.botWakeCustomInstructionsPlaceholder');
const dutiesArea = (container: HTMLElement) =>
  textAreaWith(container, 'channel.botWakeDutiesPlaceholder');

/** The wake switch: the first switch on the tab, since its block comes first. */
const masterSwitch = () => screen.getAllByRole('switch')[0];

const platformDef = {
  documentation: {},
  id: 'discord',
  name: 'Discord',
  schema: discordSchema,
} as unknown as SerializedPlatformDefinition;

const feishuDef = {
  documentation: {},
  id: 'feishu',
  name: 'Feishu',
  schema: feishuSchema,
} as unknown as SerializedPlatformDefinition;

/** Mounts the form the way the channel page does: a saved bot, its settings merged with the defaults. */
const Harness = ({
  activeTab = 'wake',
  def = platformDef,
  moduleControls,
  settings,
}: {
  activeTab?: 'reply' | 'wake';
  def?: SerializedPlatformDefinition;
  moduleControls?: ModuleControls;
  settings?: Record<string, unknown>;
}) => {
  const form = useForm<ChannelFormValues>();
  const saved = mergeSettingsWithDefaults(def.schema, settings ?? {});

  useEffect(() => {
    form.setValues(
      getChannelFormValues({ applicationId: '1', credentials: {}, settings: saved }) as never,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Body
      hasConfig
      activeTab={activeTab}
      currentConfig={{ applicationId: '1', credentials: {}, settings: saved }}
      form={form}
      moduleControls={moduleControls}
      platformDef={def}
    />
  );
};

const en = agentEn as Record<string, string>;
const zh = agentZh as Record<string, string>;

describe('channel settings form: bot-wake options', () => {
  it('shows the switch, with only the keywords beside it while it is off', () => {
    state.copy = en;

    render(<Harness settings={{ botWakeEnabled: false }} />);

    const master = masterSwitch();
    expect(screen.getByText(en['channel.botWakeEnabled'])).toBeInTheDocument();
    expect(master).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(en['channel.watchKeywords'])).toBeInTheDocument();
    // Nothing that tunes how the bot speaks up on its own while it may not.
    expect(screen.queryByText(en['channel.wake.section.judgement'])).not.toBeInTheDocument();
    expect(screen.queryByText(en['channel.botWakeScope'])).not.toBeInTheDocument();
    expect(screen.queryByText(en['channel.botWakePace'])).not.toBeInTheDocument();
  });

  it('opens the options when the switch is turned on, and folds them when it is turned off', () => {
    state.copy = en;

    render(<Harness settings={{ botWakeEnabled: false }} />);
    fireEvent.click(masterSwitch());

    expect(screen.getByText(en['channel.wake.section.judgement'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeScope'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakePace'])).toBeInTheDocument();

    fireEvent.click(masterSwitch());

    expect(screen.queryByText(en['channel.botWakeScope'])).not.toBeInTheDocument();
    expect(screen.getByText(en['channel.watchKeywords'])).toBeInTheDocument();
  });

  it('shows the rules straight away for a bot with the switch on, the timings after batching is on', () => {
    state.copy = en;

    render(<Harness settings={{ botWakeEnabled: true }} />);

    expect(masterSwitch()).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(en['channel.botWakeScope'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeAllowChannels'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeCustomInstructionsEnabled'])).toBeInTheDocument();
    // The pace is one choice; its numbers stay out of the way until it is custom.
    expect(screen.getByText(en['channel.botWakePace'])).toBeInTheDocument();
    expect(screen.queryByText(en['channel.botWakeSchedulerMode'])).not.toBeInTheDocument();
    expect(screen.queryByText(en['channel.botWakeCollectSeconds'])).not.toBeInTheDocument();
  });

  it('lists where it may join, and the pace, as choices that each say what they do', () => {
    state.copy = en;

    render(<Harness settings={{ botWakeEnabled: true }} />);

    const scope = screen.getByRole('radiogroup', { name: en['channel.botWakeScope'] });
    expect(scope).toHaveTextContent(en['channel.botWakeScopeBotThreadsHint']);
    expect(
      screen.getByRole('radio', { name: new RegExp(en['channel.botWakeScopeAll']) }),
    ).toHaveAttribute('aria-checked', 'true');
    const pace = screen.getByRole('radiogroup', { name: en['channel.botWakePace'] });
    expect(pace).toHaveTextContent(en['channel.botWakePaceCalm']);
    expect(pace).toHaveTextContent(en['channel.access.recommended']);
  });

  it('opens the numbers when the pace is set to custom', () => {
    state.copy = en;

    render(<Harness settings={{ botWakeEnabled: true }} />);
    fireEvent.click(
      screen.getByRole('radio', { name: new RegExp(en['channel.botWakePaceCustom']) }),
    );

    expect(screen.getByText(en['channel.botWakeWindowSeconds'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeSchedulerMode'])).toBeInTheDocument();
  });

  it('explains what the options do', () => {
    state.copy = en;

    render(<Harness />);

    expect(screen.getByText(en['channel.wake.intro'])).toBeInTheDocument();
  });

  it('offers them on Feishu too, naming the scope that lets the bot hear group messages', () => {
    state.copy = en;

    render(<Harness def={feishuDef} settings={{ botWakeEnabled: true }} />);

    expect(screen.getByText(en['channel.wake.intro'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeScope'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.wake.feishuScope.desc'])).toBeInTheDocument();
  });

  it('names no Feishu scope on Discord', () => {
    state.copy = en;

    render(<Harness />);

    expect(screen.queryByText(en['channel.wake.feishuScope.desc'])).not.toBeInTheDocument();
  });

  it('opens straight onto the options for a bot that already has them on', () => {
    state.copy = en;

    // A bot with tuned numbers: the server projection opens them under a custom pace.
    render(
      <Harness
        settings={flattenBotWakeSettings({
          botWakeEnabled: true,
          botWakeSchedulerMode: 'enforce',
        })!}
      />,
    );

    expect(screen.getByText(en['channel.botWakeScope'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeCollectSeconds'])).toBeInTheDocument();
    expect(screen.getByText(en['channel.botWakeCooldownSeconds'])).toBeInTheDocument();
  });

  it('reads in Chinese for a Chinese user', () => {
    state.copy = zh;

    render(<Harness settings={{ botWakeEnabled: true }} />);

    expect(screen.getByText('插话频率')).toBeInTheDocument();
    expect(screen.getByText('自定义说明')).toBeInTheDocument();
    expect(screen.queryByText('channel.botWakeScope')).not.toBeInTheDocument();
  });

  it('offers no "Rules" or "Addressed-to-bot check" mode to pick: they always enforce', () => {
    state.copy = en;

    render(<Harness settings={{ botWakeEnabled: true }} />);

    expect(screen.queryByText('Rules')).not.toBeInTheDocument();
    expect(screen.queryByText('Addressed-to-bot check')).not.toBeInTheDocument();
    expect(screen.queryByText('Record only')).not.toBeInTheDocument();
  });

  it('groups the options into the switch, judgement, keywords, channels and pace, each under its own title', () => {
    state.copy = en;

    render(<Harness settings={{ botWakeEnabled: true }} />);

    const titles = ['switch', 'judgement', 'keywords', 'channels', 'pace'].map((key) =>
      screen.getByText(en[`channel.wake.section.${key}`]),
    );
    // Titles come in page order.
    for (let i = 1; i < titles.length; i++) {
      expect(
        titles[i - 1].compareDocumentPosition(titles[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    // Each option sits in its own section: the list of channels after the "Channels" title and
    // before "Pace", the pace choice after "Pace".
    const position = (node: HTMLElement) => (a: HTMLElement) =>
      node.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING;
    const channelsTitle = screen.getByText(en['channel.wake.section.channels']);
    const paceTitle = screen.getByText(en['channel.wake.section.pace']);
    expect(
      position(channelsTitle)(screen.getByText(en['channel.botWakeAllowChannels'])),
    ).toBeTruthy();
    expect(position(screen.getByText(en['channel.botWakeAllowChannels']))(paceTitle)).toBeTruthy();
    expect(position(paceTitle)(screen.getByText(en['channel.botWakePace']))).toBeTruthy();
  });

  it('gives the custom instructions a text area of their own, large enough to write a prompt', () => {
    state.copy = en;

    const { container } = render(
      <Harness settings={{ botWakeCustomInstructionsEnabled: true, botWakeEnabled: true }} />,
    );

    const area = instructionsArea(container)!;
    expect(area).toBeInTheDocument();
    expect(Number(area.getAttribute('rows'))).toBeGreaterThanOrEqual(8);
    expect(Number(area.getAttribute('maxlength'))).toBeGreaterThanOrEqual(2000);
    // Multi-line next to the duties and the reply style only: the others stay single-line.
    expect(container.querySelectorAll('textarea')).toHaveLength(3);
  });

  it('opens the wake options with the duties: a text area, empty by default, and its dial', () => {
    state.copy = en;

    const { container } = render(<Harness settings={{ botWakeEnabled: true }} />);

    const title = screen.getByText(en['channel.wake.section.judgement']);
    const label = screen.getByText(en['channel.botWakeDuties']);
    expect(title).toHaveTextContent('Duties');
    expect(title.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dutiesArea(container)).toHaveValue('');
    expect(screen.getByText(en['channel.botWakeDutiesThreshold'])).toBeInTheDocument();
    // The retired options are gone from the page.
    expect(screen.queryByText('Help me')).not.toBeInTheDocument();
    expect(screen.queryByText('Help others')).not.toBeInTheDocument();
  });

  it('keeps the text area folded until its switch is on', () => {
    state.copy = en;

    const { container } = render(<Harness settings={{ botWakeEnabled: true }} />);

    expect(screen.getByText(en['channel.botWakeCustomInstructionsEnabled'])).toBeInTheDocument();
    expect(instructionsArea(container)).not.toBeInTheDocument();
  });

  it('shows instructions saved before the switch existed, switched on', () => {
    state.copy = en;

    // What the server hands the form: the stored settings through its projection.
    const { container } = render(
      <Harness
        settings={flattenBotWakeSettings({
          botWakeCustomInstructions: 'Only answer billing questions.\nNever joke.',
          botWakeEnabled: true,
        })!}
      />,
    );

    expect(instructionsArea(container)).toHaveValue('Only answer billing questions.\nNever joke.');
  });

  describe('a Save in the corner of each block', () => {
    const WAKE_IDS = ['wake-keywords', 'wake-channels', 'wake-pace', 'wake-judgement'] as const;
    const controls = (overrides: Partial<ModuleControls> = {}): ModuleControls => ({
      dirty: [],
      ids: WAKE_IDS,
      onDiscard: vi.fn(),
      onSave: vi.fn(),
      ...overrides,
    });
    const saveButtons = () => screen.getAllByRole('button', { name: en['channel.module.save'] });

    it('gives each of the four blocks its own Save, all disabled while nothing has changed, and the switch none', () => {
      state.copy = en;

      render(<Harness moduleControls={controls()} settings={{ botWakeEnabled: true }} />);

      expect(saveButtons()).toHaveLength(4);
      for (const button of saveButtons()) expect(button).toBeDisabled();
    });

    it('lights up only the block that has a change, and saves that block', () => {
      state.copy = en;
      const onSave = vi.fn();

      render(
        <Harness
          moduleControls={controls({ dirty: ['wake-pace'], onSave })}
          settings={{ botWakeEnabled: true }}
        />,
      );

      expect(screen.getAllByText(en['channel.module.unsaved'])).toHaveLength(1);
      const enabled = saveButtons().filter((button) => !(button as HTMLButtonElement).disabled);
      expect(enabled).toHaveLength(1);
      fireEvent.click(enabled[0]);
      expect(onSave).toHaveBeenCalledWith('wake-pace');
      // It sits in the Pace block, the last one, after the judgement, keywords and channels.
      expect(saveButtons().indexOf(enabled[0])).toBe(3);
    });

    it('discards one block’s changes by id', () => {
      state.copy = en;
      const onDiscard = vi.fn();

      render(
        <Harness
          moduleControls={controls({ dirty: ['wake-judgement'], onDiscard })}
          settings={{ botWakeEnabled: true }}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: en['channel.discard'] }));

      expect(onDiscard).toHaveBeenCalledWith('wake-judgement');
    });

    it('shows no Save while the bot is still being created: the setup steps save it all at once', () => {
      state.copy = en;

      render(<Harness settings={{ botWakeEnabled: true }} />);

      expect(screen.queryByRole('button', { name: en['channel.module.save'] })).toBeNull();
    });

    it('leaves the replies without one: they save themselves', () => {
      state.copy = en;

      render(<Harness activeTab="reply" moduleControls={controls()} />);

      expect(screen.queryByRole('button', { name: en['channel.module.save'] })).toBeNull();
    });
  });
});

describe('channel settings form: reply placement', () => {
  it('lists where to reply as choices that each say what they do, like who may DM it', () => {
    state.copy = zh;

    render(<Harness activeTab="reply" />);

    const placement = screen.getByRole('radiogroup', { name: zh['channel.replyPlacement'] });
    // Both consequences are readable without opening a dropdown.
    expect(placement).toHaveTextContent(zh['channel.replyPlacementAgentHint']);
    expect(placement).toHaveTextContent(zh['channel.replyPlacementThreadHint']);
    expect(placement).toHaveTextContent(zh['channel.access.recommended']);
    expect(screen.queryByRole('combobox', { name: zh['channel.replyPlacement'] })).toBeNull();

    const agent = screen.getByRole('radio', {
      name: new RegExp(zh['channel.replyPlacementAgent']),
    });
    const thread = screen.getByRole('radio', {
      name: new RegExp(zh['channel.replyPlacementThread']),
    });
    expect(agent).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(thread);
    expect(thread).toHaveAttribute('aria-checked', 'true');
    expect(agent).toHaveAttribute('aria-checked', 'false');
  });
});
