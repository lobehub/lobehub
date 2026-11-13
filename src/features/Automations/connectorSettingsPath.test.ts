import { describe, expect, it } from 'vitest';

import {
  MOBILE_SELECTION_PARAM,
  parseMobileSelection,
} from '@/features/Settings/skill/mobileSelection';

import { connectorSettingsPath } from './connectorSettingsPath';

const selectionOf = (path: string) =>
  parseMobileSelection(new URL(path, 'https://app.test').searchParams.get(MOBILE_SELECTION_PARAM));

describe('connectorSettingsPath', () => {
  it('opens a user connector detail through the page own selection param', () => {
    const path = connectorSettingsPath({ agentId: null, identifier: 'mwe' });

    expect(path.startsWith('/settings/connector?')).toBe(true);
    expect(selectionOf(path)).toEqual({ identifier: 'mwe', type: 'mcp-connector' });
  });

  it('keeps an identifier with reserved characters intact', () => {
    const path = connectorSettingsPath({ identifier: 'acme:ci/events v2' });

    expect(selectionOf(path)).toEqual({ identifier: 'acme:ci/events v2', type: 'mcp-connector' });
  });

  it('sends an agent-owned connector to the list', () => {
    expect(connectorSettingsPath({ agentId: 'agt_1', identifier: 'mwe' })).toBe(
      '/settings/connector',
    );
  });

  it('falls back to the list without a connector', () => {
    expect(connectorSettingsPath(null)).toBe('/settings/connector');
    expect(connectorSettingsPath({ identifier: '' })).toBe('/settings/connector');
  });
});
