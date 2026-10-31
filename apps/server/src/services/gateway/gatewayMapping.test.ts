// @vitest-environment node
import { resolveBotGatewayCapabilities } from './gatewayMapping';

vi.mock('@/envs/gateway', () => ({ gatewayEnv: {} }));

describe('resolveBotGatewayCapabilities', () => {
  it.each([
    { enabled: true, name: 'no rules at all: bot-wake is on by default', settings: {} },
    { enabled: true, name: 'null settings: bot-wake is on by default', settings: null },
    { enabled: false, name: 'switched off, no keywords', settings: { botWakeDisabled: true } },
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
      settings: { botWakeDisabled: false },
    },
    {
      enabled: false,
      name: 'the settings form saved with bot-wake off',
      settings: { botWakeDisabled: true, botWakeMode: 'shadow', botWakeScope: 'all' },
    },
    {
      enabled: false,
      name: 'bot-wake on in the form but never joining unprompted',
      settings: { botWakeDisabled: false, botWakeScope: 'none' },
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
    {
      enabled: true,
      name: 'garbage botWake value: the flat keys are read',
      settings: { botWake: 7 },
    },
    {
      enabled: false,
      name: 'garbage botWake value, switched off',
      settings: { botWake: 7, botWakeDisabled: true },
    },
  ])('$name -> messageMonitoring.enabled=$enabled', ({ enabled, settings }) => {
    expect(resolveBotGatewayCapabilities(settings)).toEqual({ messageMonitoring: { enabled } });
  });
});
