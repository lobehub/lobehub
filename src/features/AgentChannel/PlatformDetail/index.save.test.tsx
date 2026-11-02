/**
 * @vitest-environment happy-dom
 */
import { toast } from '@lobehub/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { schema as discordSchema } from '@/server/services/bot/platforms/discord/schema';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import agentEn from '../../../../packages/locales/src/default/agent';
import PlatformDetail, { type CurrentConfig } from './index';

const mocks = vi.hoisted(() => ({
  connectBot: vi.fn(),
  heterogeneous: false,
  updateBotProvider: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      ((agentEn as Record<string, string>)[key] ?? key).replace(
        '{{max}}',
        String(options?.max ?? ''),
      ),
  }),
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => undefined,
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/hooks/useAppOrigin', () => ({ useAppOrigin: () => 'https://example.test' }));
vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => ({ data: undefined, mutate: vi.fn() }),
}));
vi.mock('@/services/agentBotProvider', () => ({
  agentBotProviderService: { getRuntimeStatus: vi.fn(), wechatGetQrCode: vi.fn() },
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      connectBot: mocks.connectBot,
      createBotProvider: vi.fn(),
      deleteBotProvider: vi.fn(),
      testConnection: vi.fn(),
      updateBotProvider: mocks.updateBotProvider,
    }),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: { isAgentHeterogeneousById: () => () => mocks.heterogeneous },
  agentSelectors: { getAgentMetaById: () => () => ({ title: 'Nasa' }) },
}));
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (s: { featureFlags: Record<string, unknown> }) => unknown) =>
    selector({ featureFlags: {} }),
}));
vi.mock('@/components/InfoTooltip', () => ({ default: () => null }));
vi.mock('@/features/AgentChannel/const', () => ({ getPlatformIcon: () => null }));
// A narrow window keeps the chat preview in a drawer, out of the way.
vi.mock('./useNarrowLayout', () => ({ useNarrowLayout: () => true }));

const platformDef = {
  documentation: {},
  id: 'discord',
  name: 'Discord',
  schema: discordSchema,
} as unknown as SerializedPlatformDefinition;

const config: CurrentConfig = {
  applicationId: '100000000000000001',
  credentials: { botToken: '••••••••', publicKey: '••••••••' },
  enabled: true,
  id: 'provider-1',
  platform: 'discord',
  // A custom pace, so the numbers are on the page to edit.
  settings: { botWakeDisabled: false, botWakePace: 'custom', showUsageStats: false },
};

const en = agentEn as Record<string, string>;
const toastError = vi.spyOn(toast, 'error').mockImplementation(() => undefined as never);
const openTab = (name: string) =>
  fireEvent.click(screen.getByRole('tab', { name: new RegExp(name) }));

describe('PlatformDetail saving', () => {
  beforeEach(() => {
    mocks.heterogeneous = false;
    vi.clearAllMocks();
    mocks.updateBotProvider.mockResolvedValue(undefined);
    mocks.connectBot.mockResolvedValue({ status: 'connected' });
  });

  it('saves a reply setting by itself a moment after it changes, and writes nothing else', async () => {
    render(<PlatformDetail agentId="agt" currentConfig={config} platformDef={platformDef} />, {
      wrapper: MemoryRouter,
    });

    openTab(en['channel.tab.reply']);
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(en['channel.showUsageStats']) }));

    await waitFor(() => expect(mocks.updateBotProvider).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
    const [id, , patch] = mocks.updateBotProvider.mock.calls[0];
    expect(id).toBe('provider-1');
    expect(patch.settings.showUsageStats).toBe(true);
    expect(patch).not.toHaveProperty('credentials');
    expect(patch).not.toHaveProperty('applicationId');
  });

  it('saves the wake switch by itself as soon as it is turned off, and hides the options', async () => {
    render(<PlatformDetail agentId="agt" currentConfig={config} platformDef={platformDef} />, {
      wrapper: MemoryRouter,
    });

    openTab(en['channel.tab.wake']);
    expect(screen.getByText(en['channel.wake.section.pace'])).toBeVisible();
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(en['channel.botWakeEnabled']) }));

    await waitFor(() => expect(mocks.updateBotProvider).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
    const [, , patch] = mocks.updateBotProvider.mock.calls[0];
    expect(patch.settings.botWakeDisabled).toBe(true);
    // The rest of the wake options are written as stored.
    expect(patch.settings.botWakePace).toBe('custom');
    expect(screen.queryByText(en['channel.wake.section.pace'])).toBeNull();
  });

  it.each([
    ['with no switch stored', { showUsageStats: false }],
    ['with the retired botWakeEnabled: false', { botWakeEnabled: false, showUsageStats: false }],
  ])(
    'shows a bot saved %s with the wake switch on, and keeps it on when saving something else',
    async (_, settings) => {
      render(
        <PlatformDetail
          agentId="agt"
          currentConfig={{ ...config, settings }}
          platformDef={platformDef}
        />,
        { wrapper: MemoryRouter },
      );

      openTab(en['channel.tab.wake']);
      expect(
        screen.getByRole('switch', { name: new RegExp(en['channel.botWakeEnabled']) }),
      ).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByText(en['channel.wake.section.pace'])).toBeVisible();

      openTab(en['channel.tab.reply']);
      fireEvent.click(
        screen.getByRole('switch', { name: new RegExp(en['channel.showUsageStats']) }),
      );

      await waitFor(() => expect(mocks.updateBotProvider).toHaveBeenCalledTimes(1), {
        timeout: 3000,
      });
      expect(mocks.updateBotProvider.mock.calls[0][2].settings.botWakeDisabled).not.toBe(true);
    },
  );

  it('writes an operator’s mode override back untouched when it saves something else', async () => {
    const override = { classifier: { mode: 'off' }, mode: 'shadow' };
    render(
      <PlatformDetail
        agentId="agt"
        platformDef={platformDef}
        currentConfig={{
          ...config,
          settings: { ...config.settings, botWake: override, botWakeDisabled: false },
        }}
      />,
      { wrapper: MemoryRouter },
    );

    openTab(en['channel.tab.reply']);
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(en['channel.showUsageStats']) }));

    await waitFor(() => expect(mocks.updateBotProvider).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
    expect(mocks.updateBotProvider.mock.calls[0][2].settings.botWake).toEqual(override);
  });

  it('shows a Save in each wake block, and on the replies only for how the bot talks', () => {
    render(<PlatformDetail agentId="agt" currentConfig={config} platformDef={platformDef} />, {
      wrapper: MemoryRouter,
    });

    openTab(en['channel.tab.wake']);
    expect(screen.getAllByRole('button', { name: en['channel.module.save'] })).toHaveLength(4);

    openTab(en['channel.tab.reply']);
    const style = screen
      .getByText(en['channel.reply.section.style'])
      .closest('div[class*="header"]')!.parentElement!;
    expect(screen.getAllByRole('button', { name: en['channel.module.save'] })).toEqual([
      within(style).getByRole('button', { name: en['channel.module.save'] }),
    ]);
  });

  it('keeps the reply style off the advanced tab and saves it only with its own Save', async () => {
    render(<PlatformDetail agentId="agt" currentConfig={config} platformDef={platformDef} />, {
      wrapper: MemoryRouter,
    });

    openTab(en['channel.tab.advanced']);
    expect(screen.queryByText(en['channel.replyStyle'])).not.toBeVisible();

    openTab(en['channel.tab.reply']);
    const area = screen.getByPlaceholderText(en['channel.replyStylePlaceholder']);
    expect(area).toBeVisible();
    fireEvent.change(area, { target: { value: 'Short and casual.' } });
    fireEvent.blur(area);

    await waitFor(() => expect(screen.getByText(en['channel.module.unsaved'])).toBeVisible());
    // Typed text is not an instant reply setting: nothing is written until Save.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mocks.updateBotProvider).not.toHaveBeenCalled();

    const style = screen
      .getByText(en['channel.reply.section.style'])
      .closest('div[class*="header"]')!.parentElement!;
    fireEvent.click(within(style).getByRole('button', { name: en['channel.module.save'] }));

    await waitFor(() => expect(mocks.updateBotProvider).toHaveBeenCalledTimes(1));
    expect(mocks.updateBotProvider.mock.calls[0][2].settings.replyStyle).toBe('Short and casual.');
  });

  it('keeps Remove and Test connection on the Connect tab, off the settings tabs', () => {
    render(<PlatformDetail agentId="agt" currentConfig={config} platformDef={platformDef} />, {
      wrapper: MemoryRouter,
    });
    const remove = () =>
      screen.queryByRole('button', { name: new RegExp(en['channel.removeChannel']) });
    const test = () =>
      screen.queryByRole('button', { name: new RegExp(en['channel.testConnection']) });

    // A saved bot opens on a settings tab.
    expect(remove()).toBeNull();
    expect(test()).toBeNull();

    openTab(en['channel.tab.connect']);
    expect(remove()).toBeVisible();
    expect(test()).toBeVisible();
    expect(screen.queryByRole('button', { name: en['channel.save'] })).toBeNull();
    expect(screen.queryByRole('button', { name: en['channel.saveAndConnect'] })).toBeNull();
  });

  it('saves only the block that was changed, and keeps another block’s unsaved edit', async () => {
    render(<PlatformDetail agentId="agt" currentConfig={config} platformDef={platformDef} />, {
      wrapper: MemoryRouter,
    });
    openTab(en['channel.tab.wake']);

    // Edit the silent-wake limit (Pace) and the duty sensitivity (Duties).
    const limit = screen.getByRole('textbox', {
      name: new RegExp(en['channel.botWakeMaxSilentWakes']),
    });
    fireEvent.change(limit, { target: { value: '5' } });
    fireEvent.blur(limit);
    const sensitivity = screen.getByRole('textbox', {
      name: new RegExp(en['channel.botWakeDutiesThreshold']),
    });
    fireEvent.change(sensitivity, { target: { value: '0.9' } });
    fireEvent.blur(sensitivity);

    await waitFor(() => expect(screen.getAllByText(en['channel.module.unsaved'])).toHaveLength(2));

    // Save Pace only.
    const pace = screen
      .getByText(en['channel.wake.section.pace'])
      .closest('div[class*="header"]')!.parentElement!;
    fireEvent.click(within(pace).getByRole('button', { name: en['channel.module.save'] }));

    await waitFor(() => expect(mocks.updateBotProvider).toHaveBeenCalledTimes(1));
    const [, , patch] = mocks.updateBotProvider.mock.calls[0];
    expect(patch.settings.botWakeMaxSilentWakes).toBe(5);
    // The sensitivity is edited but not saved: the write carries the stored value.
    expect(patch.settings.botWakeDutiesThreshold).toBe(0.65);
    expect(patch).not.toHaveProperty('credentials');
    expect(mocks.connectBot).not.toHaveBeenCalled();

    // Duties still has its unsaved edit.
    await waitFor(() => expect(screen.getAllByText(en['channel.module.unsaved'])).toHaveLength(1));
    expect(sensitivity).toHaveValue('0.9');
  });

  describe('when approving strangers has no owner ID to rely on', () => {
    const blockOf = (title: string) =>
      screen.getByText(title).closest('div[class*="header"]')!.parentElement!;
    const saveBlock = (title: string) =>
      fireEvent.click(
        within(blockOf(title)).getByRole('button', { name: en['channel.module.save'] }),
      );
    const ownerInput = () => document.querySelector<HTMLInputElement>('#channel-owner-id input')!;
    const expectOwnerIdAsked = async () => {
      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith(en['channel.access.identity.requiredToSave']),
      );
      await waitFor(() => expect(ownerInput()).toHaveFocus());
      expect(ownerInput()).toHaveAttribute('aria-invalid', 'true');
      expect(mocks.updateBotProvider).not.toHaveBeenCalled();
    };

    it('stops the conversation Save, names the field and focuses it', async () => {
      render(<PlatformDetail agentId="agt" currentConfig={config} platformDef={platformDef} />, {
        wrapper: MemoryRouter,
      });
      openTab(en['channel.tab.access']);

      fireEvent.click(screen.getByText(en['channel.access.dm.approval']));
      await waitFor(() => expect(screen.getByText(en['channel.module.unsaved'])).toBeVisible());
      saveBlock(en['channel.access.section.conversation']);

      await expectOwnerIdAsked();
    });

    it('stops the owner Save when the ID is cleared under a stored pairing policy', async () => {
      const paired = {
        ...config,
        settings: { ...config.settings, dmPolicy: 'pairing', userId: '42' },
      };
      render(<PlatformDetail agentId="agt" currentConfig={paired} platformDef={platformDef} />, {
        wrapper: MemoryRouter,
      });
      openTab(en['channel.tab.access']);

      fireEvent.change(ownerInput(), { target: { value: '  ' } });
      fireEvent.blur(ownerInput());
      await waitFor(() => expect(screen.getByText(en['channel.module.unsaved'])).toBeVisible());
      saveBlock(en['channel.access.section.identity']);

      await expectOwnerIdAsked();
    });

    it('holds Guest Mode pairing to the same rule the server applies', async () => {
      const guest = {
        ...config,
        settings: { ...config.settings, guestPolicy: 'pairing', userId: '42' },
      };
      render(<PlatformDetail agentId="agt" currentConfig={guest} platformDef={platformDef} />, {
        wrapper: MemoryRouter,
      });
      openTab(en['channel.tab.access']);

      fireEvent.change(ownerInput(), { target: { value: '' } });
      fireEvent.blur(ownerInput());
      await waitFor(() => expect(screen.getByText(en['channel.module.unsaved'])).toBeVisible());
      saveBlock(en['channel.access.section.identity']);

      await expectOwnerIdAsked();
    });

    it('leaves a typed but unsaved ID unmarked, so its own Save still goes through', async () => {
      const legacy = { ...config, settings: { ...config.settings, dmPolicy: 'pairing' } };
      render(<PlatformDetail agentId="agt" currentConfig={legacy} platformDef={platformDef} />, {
        wrapper: MemoryRouter,
      });
      openTab(en['channel.tab.access']);
      fireEvent.change(ownerInput(), { target: { value: '42' } });
      fireEvent.blur(ownerInput());

      openTab(en['channel.tab.wake']);
      const limit = screen.getByRole('textbox', {
        name: new RegExp(en['channel.botWakeMaxSilentWakes']),
      });
      fireEvent.change(limit, { target: { value: '5' } });
      fireEvent.blur(limit);
      await waitFor(() =>
        expect(screen.getAllByText(en['channel.module.unsaved'])).toHaveLength(2),
      );
      saveBlock(en['channel.wake.section.pace']);

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith(en['channel.access.identity.savePendingFirst']),
      );
      expect(mocks.updateBotProvider).not.toHaveBeenCalled();
      // The Access tab opens for the block that still has to be saved.
      await waitFor(() => expect(ownerInput()).toBeVisible());
      expect(ownerInput()).not.toHaveAttribute('aria-invalid', 'true');

      saveBlock(en['channel.access.section.identity']);
      await waitFor(() => expect(mocks.updateBotProvider).toHaveBeenCalledTimes(1));
      expect(mocks.updateBotProvider.mock.calls[0][2].settings.userId).toBe('42');
    });

    it('asks to save the changed policy, not to fill the ID, when the form no longer needs one', async () => {
      const legacy = { ...config, settings: { ...config.settings, dmPolicy: 'pairing' } };
      render(<PlatformDetail agentId="agt" currentConfig={legacy} platformDef={platformDef} />, {
        wrapper: MemoryRouter,
      });
      openTab(en['channel.tab.access']);
      fireEvent.click(screen.getByText(en['channel.access.dm.everyone']));
      fireEvent.change(screen.getByPlaceholderText(en['channel.serverId']), {
        target: { value: '7' },
      });
      fireEvent.blur(screen.getByPlaceholderText(en['channel.serverId']));
      await waitFor(() =>
        expect(screen.getAllByText(en['channel.module.unsaved'])).toHaveLength(2),
      );
      saveBlock(en['channel.access.section.identity']);

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith(en['channel.access.identity.savePendingFirst']),
      );
      expect(mocks.updateBotProvider).not.toHaveBeenCalled();
      expect(ownerInput()).not.toHaveAttribute('aria-invalid', 'true');

      saveBlock(en['channel.access.section.conversation']);
      await waitFor(() => expect(mocks.updateBotProvider).toHaveBeenCalledTimes(1));
      expect(mocks.updateBotProvider.mock.calls[0][2].settings.dmPolicy).toBe('open');
    });

    it('saves the approval choice together with the owner ID once it is filled', async () => {
      render(<PlatformDetail agentId="agt" currentConfig={config} platformDef={platformDef} />, {
        wrapper: MemoryRouter,
      });
      openTab(en['channel.tab.access']);

      fireEvent.click(screen.getByText(en['channel.access.dm.approval']));
      fireEvent.change(ownerInput(), { target: { value: '42' } });
      fireEvent.blur(ownerInput());
      await waitFor(() =>
        expect(screen.getAllByText(en['channel.module.unsaved'])).toHaveLength(2),
      );
      saveBlock(en['channel.access.section.conversation']);

      await waitFor(() => expect(mocks.updateBotProvider).toHaveBeenCalledTimes(1));
      const [, , patch] = mocks.updateBotProvider.mock.calls[0];
      expect(patch.settings.dmPolicy).toBe('pairing');
      expect(patch.settings.userId).toBe('42');
      expect(toastError).not.toHaveBeenCalled();
    });
  });
});
