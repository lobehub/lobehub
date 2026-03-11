import { describe, expect, it } from 'vitest';

import { initialState } from '../../initialState';
import { type ToolStore } from '../../store';
import { klavisStoreSelectors } from './selectors';
import { KlavisServerStatus } from './types';

describe('klavisStoreSelectors', () => {
  describe('getServers', () => {
    it('should return empty array when no servers exist', () => {
      const state = { ...initialState } as ToolStore;
      const result = klavisStoreSelectors.getServers(state);
      expect(result).toEqual([]);
    });

    it('should return all servers', () => {
      const servers = [
        {
          identifier: 'gmail',
          serverName: 'Gmail',
          instanceId: 'inst-1',
          serverUrl: 'https://klavis.ai/gmail',
          status: KlavisServerStatus.CONNECTED,
          isAuthenticated: true,
          createdAt: Date.now(),
        },
        {
          identifier: 'github',
          serverName: 'GitHub',
          instanceId: 'inst-2',
          serverUrl: 'https://klavis.ai/github',
          status: KlavisServerStatus.PENDING_AUTH,
          isAuthenticated: false,
          createdAt: Date.now(),
        },
      ];
      const state = { ...initialState, servers } as ToolStore;
      const result = klavisStoreSelectors.getServers(state);
      expect(result).toEqual(servers);
    });
  });

  describe('getConnectedServers', () => {
    it('should return only connected servers', () => {
      const servers = [
        {
          identifier: 'gmail',
          serverName: 'Gmail',
          instanceId: 'inst-1',
          serverUrl: 'https://klavis.ai/gmail',
          status: KlavisServerStatus.CONNECTED,
          isAuthenticated: true,
          createdAt: Date.now(),
        },
        {
          identifier: 'github',
          serverName: 'GitHub',
          instanceId: 'inst-2',
          serverUrl: 'https://klavis.ai/github',
          status: KlavisServerStatus.PENDING_AUTH,
          isAuthenticated: false,
          createdAt: Date.now(),
        },
        {
          identifier: 'slack',
          serverName: 'Slack',
          instanceId: 'inst-3',
          serverUrl: 'https://klavis.ai/slack',
          status: KlavisServerStatus.ERROR,
          isAuthenticated: false,
          createdAt: Date.now(),
        },
      ];
      const state = { ...initialState, servers } as ToolStore;
      const result = klavisStoreSelectors.getConnectedServers(state);
      expect(result).toHaveLength(1);
      expect(result[0].serverName).toBe('Gmail');
    });

    it('should return empty array when no servers are connected', () => {
      const servers = [
        {
          identifier: 'github',
          serverName: 'GitHub',
          instanceId: 'inst-2',
          serverUrl: 'https://klavis.ai/github',
          status: KlavisServerStatus.PENDING_AUTH,
          isAuthenticated: false,
          createdAt: Date.now(),
        },
      ];
      const state = { ...initialState, servers } as ToolStore;
      const result = klavisStoreSelectors.getConnectedServers(state);
      expect(result).toEqual([]);
    });
  });

  describe('getPendingAuthServers', () => {
    it('should return only pending auth servers', () => {
      const servers = [
        {
          identifier: 'gmail',
          serverName: 'Gmail',
          instanceId: 'inst-1',
          serverUrl: 'https://klavis.ai/gmail',
          status: KlavisServerStatus.CONNECTED,
          isAuthenticated: true,
          createdAt: Date.now(),
        },
        {
          identifier: 'github',
          serverName: 'GitHub',
          instanceId: 'inst-2',
          serverUrl: 'https://klavis.ai/github',
          status: KlavisServerStatus.PENDING_AUTH,
          isAuthenticated: false,
          oauthUrl: 'https://oauth.klavis.ai/github',
          createdAt: Date.now(),
        },
      ];
      const state = { ...initialState, servers } as ToolStore;
      const result = klavisStoreSelectors.getPendingAuthServers(state);
      expect(result).toHaveLength(1);
      expect(result[0].serverName).toBe('GitHub');
    });
  });

  describe('getServerByIdentifier', () => {
    it('should return server by identifier', () => {
      const servers = [
        {
          identifier: 'gmail',
          serverName: 'Gmail',
          instanceId: 'inst-1',
          serverUrl: 'https://klavis.ai/gmail',
          status: KlavisServerStatus.CONNECTED,
          isAuthenticated: true,
          createdAt: Date.now(),
        },
      ];
      const state = { ...initialState, servers } as ToolStore;
      const result = klavisStoreSelectors.getServerByIdentifier('gmail')(state);
      expect(result?.identifier).toBe('gmail');
      expect(result?.serverName).toBe('Gmail');
    });

    it('should return undefined when server not found', () => {
      const state = { ...initialState } as ToolStore;
      const result = klavisStoreSelectors.getServerByIdentifier('non-existent')(state);
      expect(result).toBeUndefined();
    });
  });

  describe('getAllServerIdentifiers', () => {
    it('should return set of all server identifiers', () => {
      const servers = [
        {
          identifier: 'gmail',
          serverName: 'Gmail',
          instanceId: 'inst-1',
          serverUrl: 'https://klavis.ai/gmail',
          status: KlavisServerStatus.CONNECTED,
          isAuthenticated: true,
          createdAt: Date.now(),
        },
        {
          identifier: 'github',
          serverName: 'GitHub',
          instanceId: 'inst-2',
          serverUrl: 'https://klavis.ai/github',
          status: KlavisServerStatus.PENDING_AUTH,
          isAuthenticated: false,
          createdAt: Date.now(),
        },
      ];
      const state = { ...initialState, servers } as ToolStore;
      const result = klavisStoreSelectors.getAllServerIdentifiers(state);
      expect(result).toEqual(new Set(['gmail', 'github']));
    });
  });

  describe('isKlavisServer', () => {
    it('should return true for existing server by identifier', () => {
      const servers = [
        {
          identifier: 'gmail',
          serverName: 'Gmail',
          instanceId: 'inst-1',
          serverUrl: 'https://klavis.ai/gmail',
          status: KlavisServerStatus.CONNECTED,
          isAuthenticated: true,
          createdAt: Date.now(),
        },
      ];
      const state = { ...initialState, servers } as ToolStore;
      const result = klavisStoreSelectors.isKlavisServer('gmail')(state);
      expect(result).toBe(true);
    });

    it('should return false for non-existing server', () => {
      const state = { ...initialState } as ToolStore;
      const result = klavisStoreSelectors.isKlavisServer('non-existent')(state);
      expect(result).toBe(false);
    });
  });

  describe('isServerLoading', () => {
    it('should return true when server is loading', () => {
      const state = {
        ...initialState,
        loadingServerIds: new Set(['gmail']),
      } as ToolStore;
      const result = klavisStoreSelectors.isServerLoading('gmail')(state);
      expect(result).toBe(true);
    });

    it('should return false when server is not loading', () => {
      const state = {
        ...initialState,
        loadingServerIds: new Set(),
      } as ToolStore;
      const result = klavisStoreSelectors.isServerLoading('gmail')(state);
      expect(result).toBe(false);
    });
  });

  describe('isToolExecuting', () => {
    it('should return true when tool is executing', () => {
      const state = {
        ...initialState,
        executingToolIds: new Set(['https://klavis.ai/gmail:sendEmail']),
      } as ToolStore;
      const result = klavisStoreSelectors.isToolExecuting(
        'https://klavis.ai/gmail',
        'sendEmail',
      )(state);
      expect(result).toBe(true);
    });

    it('should return false when tool is not executing', () => {
      const state = {
        ...initialState,
        executingToolIds: new Set(),
      } as ToolStore;
      const result = klavisStoreSelectors.isToolExecuting(
        'https://klavis.ai/gmail',
        'sendEmail',
      )(state);
      expect(result).toBe(false);
    });
  });

  describe('getAllTools', () => {
    it('should return all tools from connected servers', () => {
      const servers = [
        {
          identifier: 'gmail',
          serverName: 'Gmail',
          instanceId: 'inst-1',
          serverUrl: 'https://klavis.ai/gmail',
          status: KlavisServerStatus.CONNECTED,
          isAuthenticated: true,
          createdAt: Date.now(),
          tools: [
            { name: 'sendEmail', description: 'Send email', inputSchema: { type: 'object' } },
            { name: 'readEmails', description: 'Read emails', inputSchema: { type: 'object' } },
          ],
        },
        {
          identifier: 'github',
          serverName: 'GitHub',
          instanceId: 'inst-2',
          serverUrl: 'https://klavis.ai/github',
          status: KlavisServerStatus.PENDING_AUTH,
          isAuthenticated: false,
          createdAt: Date.now(),
          tools: [{ name: 'createPR', description: 'Create PR', inputSchema: { type: 'object' } }],
        },
      ];
      const state = { ...initialState, servers } as ToolStore;
      const result = klavisStoreSelectors.getAllTools(state);
      // Only tools from connected server (Gmail) should be returned
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('sendEmail');
      expect(result[0].serverName).toBe('Gmail');
      expect(result[1].name).toBe('readEmails');
    });

    it('should return empty array when no connected servers have tools', () => {
      const servers = [
        {
          identifier: 'gmail',
          serverName: 'Gmail',
          instanceId: 'inst-1',
          serverUrl: 'https://klavis.ai/gmail',
          status: KlavisServerStatus.CONNECTED,
          isAuthenticated: true,
          createdAt: Date.now(),
        },
      ];
      const state = { ...initialState, servers } as ToolStore;
      const result = klavisStoreSelectors.getAllTools(state);
      expect(result).toEqual([]);
    });
  });

  describe('klavisAsLobeTools', () => {
    it('should convert Klavis servers to LobeTool format', () => {
      const servers = [
        {
          identifier: 'gmail',
          serverName: 'Gmail',
          instanceId: 'inst-1',
          serverUrl: 'https://klavis.ai/gmail',
          status: KlavisServerStatus.CONNECTED,
          isAuthenticated: true,
          createdAt: Date.now(),
          tools: [
            { name: 'sendEmail', description: 'Send email', inputSchema: { type: 'object' } },
          ],
        },
      ];
      const state = { ...initialState, servers } as ToolStore;
      const result = klavisStoreSelectors.klavisAsLobeTools(state);

      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('gmail');
      expect(result[0].type).toBe('plugin');
      expect(result[0].manifest.api).toHaveLength(1);
      expect(result[0].manifest.api[0].name).toBe('sendEmail');
      expect(result[0].manifest.meta.title).toBe('Gmail');
    });

    it('should not include disconnected servers', () => {
      const servers = [
        {
          identifier: 'gmail',
          serverName: 'Gmail',
          instanceId: 'inst-1',
          serverUrl: 'https://klavis.ai/gmail',
          status: KlavisServerStatus.PENDING_AUTH,
          isAuthenticated: false,
          createdAt: Date.now(),
          tools: [
            { name: 'sendEmail', description: 'Send email', inputSchema: { type: 'object' } },
          ],
        },
      ];
      const state = { ...initialState, servers } as ToolStore;
      const result = klavisStoreSelectors.klavisAsLobeTools(state);
      expect(result).toEqual([]);
    });

    it('should not include servers without tools', () => {
      const servers = [
        {
          identifier: 'gmail',
          serverName: 'Gmail',
          instanceId: 'inst-1',
          serverUrl: 'https://klavis.ai/gmail',
          status: KlavisServerStatus.CONNECTED,
          isAuthenticated: true,
          createdAt: Date.now(),
        },
      ];
      const state = { ...initialState, servers } as ToolStore;
      const result = klavisStoreSelectors.klavisAsLobeTools(state);
      expect(result).toEqual([]);
    });
  });
});
