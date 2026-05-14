// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KlavisService } from './index';

const mocks = vi.hoisted(() => ({
  PluginModel: vi.fn(),
  pluginQuery: vi.fn(),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: mocks.PluginModel,
}));

vi.mock('@/libs/klavis', () => ({
  getKlavisClient: vi.fn(),
  isKlavisClientAvailable: vi.fn(() => true),
}));

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

describe('KlavisService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.PluginModel.mockImplementation(() => ({
      query: mocks.pluginQuery,
    }));
  });

  describe('getKlavisManifests', () => {
    it('filters deprecated Klavis providers from server manifests', async () => {
      mocks.pluginQuery.mockResolvedValue([
        {
          customParams: { klavis: { isAuthenticated: true, serverName: 'Gmail' } },
          identifier: 'gmail',
          manifest: {
            api: [{ name: 'sendEmail', parameters: { type: 'object' } }],
            meta: { title: 'Gmail' },
          },
        },
        {
          customParams: { klavis: { isAuthenticated: true, serverName: 'Notion' } },
          identifier: 'notion',
          manifest: {
            api: [{ name: 'notion-search', parameters: { type: 'object' } }],
            meta: { title: 'Notion' },
          },
        },
        {
          customParams: { klavis: { isAuthenticated: false, serverName: 'Google Calendar' } },
          identifier: 'google-calendar',
          manifest: {
            api: [{ name: 'listEvents', parameters: { type: 'object' } }],
            meta: { title: 'Google Calendar' },
          },
        },
      ]);

      const service = new KlavisService({ db: {} as any, userId: 'user-1' });

      const manifests = await service.getKlavisManifests();

      expect(manifests.map((manifest) => manifest.identifier)).toEqual(['gmail']);
    });
  });
});
