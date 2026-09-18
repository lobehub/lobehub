import { describe, expect, it } from 'vitest';

import { buildCustomConnectorMetadata, cleanRecord } from './connectorMetadata';

describe('cleanRecord', () => {
  it('drops pairs with empty keys or values and trims nothing else', () => {
    expect(
      cleanRecord({ '': 'x', 'X-MCP-Readonly': 'true', 'X-Whitespace': '   ', 'y': '' }),
    ).toEqual({ 'X-MCP-Readonly': 'true' });
  });

  it('returns undefined for empty, missing, or non-record input', () => {
    expect(cleanRecord()).toBeUndefined();
    expect(cleanRecord({})).toBeUndefined();
    expect(cleanRecord({ ' ': ' ' })).toBeUndefined();
    expect(cleanRecord([] as unknown as Record<string, string>)).toBeUndefined();
  });
});

describe('buildCustomConnectorMetadata', () => {
  describe('create (no existing metadata)', () => {
    it('persists description, avatar and custom headers together (#16070)', () => {
      expect(
        buildCustomConnectorMetadata({
          avatar: 'https://plugin-avatar.com/a.png',
          description: 'My MCP server',
          headers: { 'X-MCP-Readonly': 'true' },
        }),
      ).toEqual({
        avatar: 'https://plugin-avatar.com/a.png',
        customHeaders: { 'X-MCP-Readonly': 'true' },
        description: 'My MCP server',
      });
    });

    it('omits keys for empty or whitespace-only form fields', () => {
      expect(
        buildCustomConnectorMetadata({ avatar: '   ', description: '', headers: { ' ': '' } }),
      ).toEqual({});
    });

    it('trims description and avatar', () => {
      expect(buildCustomConnectorMetadata({ avatar: ' a.png ', description: ' hi ' })).toEqual({
        avatar: 'a.png',
        description: 'hi',
      });
    });
  });

  describe('edit (merging into existing metadata)', () => {
    it('preserves sibling keys the form does not own', () => {
      const existing = {
        composio: { connectedAccountId: 'ca_1' },
        customHeaders: { 'X-Old': '1' },
        description: 'old',
        mountedByAgentId: 'agt_1',
      };
      expect(
        buildCustomConnectorMetadata({ description: 'new', headers: { 'X-New': '2' } }, existing),
      ).toEqual({
        composio: { connectedAccountId: 'ca_1' },
        customHeaders: { 'X-New': '2' },
        description: 'new',
        mountedByAgentId: 'agt_1',
      });
    });

    it('deletes form-owned keys the user cleared', () => {
      const existing = {
        avatar: 'a.png',
        customHeaders: { 'X-Old': '1' },
        description: 'old',
        other: true,
      };
      expect(buildCustomConnectorMetadata({}, existing)).toEqual({ other: true });
    });

    it('does not mutate the existing metadata object', () => {
      const existing = { description: 'old' };
      buildCustomConnectorMetadata({ description: 'new' }, existing);
      expect(existing).toEqual({ description: 'old' });
    });

    it('handles null/undefined existing metadata', () => {
      expect(buildCustomConnectorMetadata({ description: 'd' }, null)).toEqual({
        description: 'd',
      });
      expect(buildCustomConnectorMetadata({ avatar: 'a' }, undefined)).toEqual({ avatar: 'a' });
    });
  });
});
