/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { schema as discordSchema } from '@/server/services/bot/platforms/discord/schema';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import agentEn from '../../../../packages/locales/src/default/agent';
import PlatformDetail, { type CurrentConfig } from './index';

const mocks = vi.hoisted(() => ({
  connectBot: vi.fn(),
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
  agentSelectors: { getAgentMetaById: () => () => ({ title: 'Nasa' }) },
}));
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (s: { featureFlags: Record<string, unknown> }) => unknown) =>
    selector({ featureFlags: { enableBotWake: true } }),
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
  settings: { botWakeEnabled: true, botWakePace: 'custom', showUsageStats: false },
};

const en = agentEn as Record<string, string>;
const openTab = (name: string) =>
  fireEvent.click(screen.getByRole('tab', { name: new RegExp(name) }));

describe('PlatformDetail saving', () => {
  beforeEach(() => {
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

  it('writes an operator’s mode override back untouched when it saves something else', async () => {
    const override = { classifier: { mode: 'off' }, mode: 'shadow' };
    render(
      <PlatformDetail
        agentId="agt"
        platformDef={platformDef}
        currentConfig={{
          ...config,
          settings: { ...config.settings, botWake: override, botWakeEnabled: true },
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

  it('shows a Save in each wake block and none on the replies', () => {
    render(<PlatformDetail agentId="agt" currentConfig={config} platformDef={platformDef} />, {
      wrapper: MemoryRouter,
    });

    openTab(en['channel.tab.wake']);
    expect(screen.getAllByRole('button', { name: en['channel.module.save'] })).toHaveLength(4);

    openTab(en['channel.tab.reply']);
    expect(screen.queryByRole('button', { name: en['channel.module.save'] })).toBeNull();
  });

  it('leaves the bottom bar to Remove and Test connection for a saved bot', () => {
    render(<PlatformDetail agentId="agt" currentConfig={config} platformDef={platformDef} />, {
      wrapper: MemoryRouter,
    });

    expect(
      screen.getByRole('button', { name: new RegExp(en['channel.removeChannel']) }),
    ).toBeVisible();
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
});
