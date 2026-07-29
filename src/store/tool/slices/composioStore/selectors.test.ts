import { describe, expect, it } from 'vitest';

import { initialState } from '../../initialState';
import { type ToolStore } from '../../store';
import { composioStoreSelectors } from './selectors';
import { ComposioServerStatus } from './types';

const makeServer = (overrides = {}) => ({
  appSlug: 'GMAIL',
  authConfigId: 'ac_test',
  connectedAccountId: 'ca_test',
  createdAt: 0,
  identifier: 'gmail',
  label: 'Gmail',
  status: ComposioServerStatus.ACTIVE,
  ...overrides,
});

describe('composioStoreSelectors', () => {
  describe('getServers', () => {
    it('returns empty array when no servers exist', () => {
      const state = { ...initialState } as ToolStore;
      expect(composioStoreSelectors.getServers(state)).toEqual([]);
    });

    it('returns all servers', () => {
      const servers = [makeServer(), makeServer({ identifier: 'slack', label: 'Slack' })];
      const state = { ...initialState, composioServers: servers } as ToolStore;
      expect(composioStoreSelectors.getServers(state)).toEqual(servers);
    });
  });

  describe('getConnectedServers', () => {
    it('returns only ACTIVE servers', () => {
      const servers = [
        makeServer({ status: ComposioServerStatus.ACTIVE }),
        makeServer({ identifier: 'slack', status: ComposioServerStatus.PENDING_AUTH }),
      ];
      const state = { ...initialState, composioServers: servers } as ToolStore;
      const result = composioStoreSelectors.getConnectedServers(state);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('gmail');
    });
  });

  describe('getPendingAuthServers', () => {
    it('returns only PENDING_AUTH servers', () => {
      const servers = [
        makeServer({ status: ComposioServerStatus.ACTIVE }),
        makeServer({ identifier: 'slack', status: ComposioServerStatus.PENDING_AUTH }),
      ];
      const state = { ...initialState, composioServers: servers } as ToolStore;
      const result = composioStoreSelectors.getPendingAuthServers(state);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('slack');
    });
  });

  describe('getServerByIdentifier', () => {
    it('returns server by identifier', () => {
      const state = { ...initialState, composioServers: [makeServer()] } as ToolStore;
      const result = composioStoreSelectors.getServerByIdentifier('gmail')(state);
      expect(result?.identifier).toBe('gmail');
    });

    it('returns undefined when not found', () => {
      const state = { ...initialState } as ToolStore;
      expect(composioStoreSelectors.getServerByIdentifier('notexist')(state)).toBeUndefined();
    });
  });

  describe('isComposioServer', () => {
    it('returns true for existing server', () => {
      const state = { ...initialState, composioServers: [makeServer()] } as ToolStore;
      expect(composioStoreSelectors.isComposioServer('gmail')(state)).toBe(true);
    });

    it('returns false for non-existing server', () => {
      const state = { ...initialState } as ToolStore;
      expect(composioStoreSelectors.isComposioServer('gmail')(state)).toBe(false);
    });
  });

  describe('isServerLoading', () => {
    it('returns true when loading', () => {
      const state = {
        ...initialState,
        loadingComposioServerIds: new Set(['gmail']),
      } as ToolStore;
      expect(composioStoreSelectors.isServerLoading('gmail')(state)).toBe(true);
    });

    it('returns false when not loading', () => {
      const state = {
        ...initialState,
        loadingComposioServerIds: new Set(),
      } as ToolStore;
      expect(composioStoreSelectors.isServerLoading('gmail')(state)).toBe(false);
    });
  });

  describe('composioAsLobeTools', () => {
    it('converts ACTIVE servers with tools to LobeTool format', () => {
      const servers = [
        makeServer({
          status: ComposioServerStatus.ACTIVE,
          tools: [
            {
              description: 'Send email',
              inputSchema: { type: 'object' },
              name: 'GMAIL_SEND_EMAIL',
            },
          ],
        }),
      ];
      const state = { ...initialState, composioServers: servers } as ToolStore;
      const result = composioStoreSelectors.composioAsLobeTools(state);

      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('gmail');
      expect(result[0].type).toBe('plugin');
      expect(result[0].manifest.api).toHaveLength(1);
    });

    it('excludes disconnected servers', () => {
      const servers = [makeServer({ status: ComposioServerStatus.PENDING_AUTH })];
      const state = { ...initialState, composioServers: servers } as ToolStore;
      expect(composioStoreSelectors.composioAsLobeTools(state)).toEqual([]);
    });

    it('excludes servers without tools', () => {
      const servers = [makeServer({ tools: undefined })];
      const state = { ...initialState, composioServers: servers } as ToolStore;
      expect(composioStoreSelectors.composioAsLobeTools(state)).toEqual([]);
    });
  });
});
