// @vitest-environment node
import { resolveBotGatewayCapabilities } from './gatewayMapping';

vi.mock('@/envs/gateway', () => ({ gatewayEnv: {} }));

describe('resolveBotGatewayCapabilities', () => {
  it.each([
    { enabled: false, name: 'no rules at all', settings: {} },
    { enabled: false, name: 'null settings', settings: null },
    {
      enabled: true,
      name: 'a watch keyword',
      settings: { watchKeywords: [{ instruction: '', keyword: 'deploy' }] },
    },
    { enabled: true, name: 'a legacy string keyword', settings: { watchKeywords: 'deploy' } },
    {
      enabled: true,
      name: 'bot-wake enabled, no keywords',
      settings: { botWake: { enabled: true } },
    },
    {
      enabled: true,
      name: 'bot-wake enabled in shadow',
      settings: { botWake: { enabled: true, mode: 'shadow' } },
    },
    {
      enabled: true,
      name: 'bot-wake enabled, classifier only',
      settings: { botWake: { classifier: { mode: 'enforce' }, enabled: true } },
    },
    {
      enabled: true,
      name: 'bot-wake switched on in the settings form',
      settings: { botWakeEnabled: true },
    },
    {
      enabled: false,
      name: 'the settings form saved with bot-wake off',
      settings: { botWakeEnabled: false, botWakeMode: 'shadow', botWakeScope: 'all' },
    },
    {
      enabled: false,
      name: 'bot-wake on in the form but never joining unprompted',
      settings: { botWakeEnabled: true, botWakeScope: 'none' },
    },
    {
      enabled: false,
      name: 'bot-wake configured but not enabled',
      settings: { botWake: { enabled: false, rules: { scope: 'all' } } },
    },
    {
      enabled: false,
      name: 'bot-wake mode off',
      settings: { botWake: { enabled: true, mode: 'off' } },
    },
    {
      enabled: false,
      name: 'bot-wake scope none',
      settings: { botWake: { enabled: true, rules: { scope: 'none' } } },
    },
    {
      enabled: true,
      name: 'keyword wins over a disabled bot-wake',
      settings: { botWake: { enabled: false }, watchKeywords: 'deploy' },
    },
    { enabled: false, name: 'garbage botWake value', settings: { botWake: 7 } },
  ])('$name -> messageMonitoring.enabled=$enabled', ({ enabled, settings }) => {
    expect(resolveBotGatewayCapabilities(settings)).toEqual({ messageMonitoring: { enabled } });
  });
});
