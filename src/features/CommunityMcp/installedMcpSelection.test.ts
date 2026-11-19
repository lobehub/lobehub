import { describe, expect, it } from 'vitest';

import { parseMobileSelection } from '@/features/Settings/skill/mobileSelection';

import { installedMcpSelection } from './installedMcpSelection';

describe('installedMcpSelection', () => {
  it('opens a connector-backed install, which has no plugin row, as a connector', () => {
    expect(parseMobileSelection(installedMcpSelection('github'))).toEqual({
      identifier: 'github',
      type: 'mcp-connector',
    });
  });

  it('opens a legacy marketplace plugin row as a plugin', () => {
    expect(parseMobileSelection(installedMcpSelection('github', 'plugin'))).toEqual({
      identifier: 'github',
      type: 'plugin',
    });
  });

  it('opens a legacy custom MCP as a connector, where its migration is offered', () => {
    expect(parseMobileSelection(installedMcpSelection('my-mcp', 'customPlugin'))).toEqual({
      identifier: 'my-mcp',
      type: 'mcp-connector',
    });
  });
});
