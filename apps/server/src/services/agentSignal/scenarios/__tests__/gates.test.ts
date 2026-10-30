// @vitest-environment node
import { resetAgentSignalUserGateCache } from '../../featureGate';
import { isBotWakeEnabled } from '../botWake/gate';
import { isAgentSignalScenarioEnabled } from '../meta';

const mocks = vi.hoisted(() => ({ getUserPreference: vi.fn() }));

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    getUserPreference = mocks.getUserPreference;
  },
}));

const db = {} as never;

describe('scenario gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAgentSignalUserGateCache();
  });

  describe('self-iteration', () => {
    it.each([
      { expected: true, name: 'Labs switch on', preference: { lab: { enableSelfLearning: true } } },
      {
        expected: false,
        name: 'Labs switch off',
        preference: { lab: { enableSelfLearning: false } },
      },
      { expected: false, name: 'no preference', preference: undefined },
    ])('$name -> $expected, ignoring any bot config', async ({ expected, preference }) => {
      mocks.getUserPreference.mockResolvedValue(preference);

      await expect(
        isAgentSignalScenarioEnabled('self-iteration', {
          botWake: { enabled: true, mode: 'enforce' },
          db,
          userId: `user-${String(expected)}-${String(preference?.lab?.enableSelfLearning)}`,
        }),
      ).resolves.toBe(expected);
    });
  });

  describe('bot-wake', () => {
    it.each([
      { config: undefined, expected: false, name: 'no bot config' },
      { config: null, expected: false, name: 'null bot config' },
      { config: {}, expected: false, name: 'enabled unset' },
      { config: { enabled: false, mode: 'enforce' as const }, expected: false, name: 'disabled' },
      { config: { enabled: true, mode: 'off' as const }, expected: false, name: 'mode off' },
      { config: { enabled: true }, expected: true, name: 'enabled, default mode' },
      { config: { enabled: true, mode: 'shadow' as const }, expected: true, name: 'shadow' },
      { config: { enabled: true, mode: 'enforce' as const }, expected: true, name: 'enforce' },
    ])('$name -> $expected', async ({ config, expected }) => {
      expect(isBotWakeEnabled(config)).toBe(expected);
      await expect(
        isAgentSignalScenarioEnabled('bot-wake', { botWake: config, db, userId: 'u' }),
      ).resolves.toBe(expected);
    });

    it('does not read the Labs switch', async () => {
      mocks.getUserPreference.mockResolvedValue({ lab: { enableSelfLearning: false } });

      await expect(
        isAgentSignalScenarioEnabled('bot-wake', {
          botWake: { enabled: true, mode: 'enforce' },
          db,
          userId: 'u',
        }),
      ).resolves.toBe(true);
      expect(mocks.getUserPreference).not.toHaveBeenCalled();
    });
  });
});
