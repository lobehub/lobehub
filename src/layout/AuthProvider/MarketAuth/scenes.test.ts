import { describe, expect, it } from 'vitest';

import { pathToMarketAuthScene } from './scenes';

describe('pathToMarketAuthScene', () => {
  it('maps sandbox execution paths to the sandbox scene', () => {
    expect(pathToMarketAuthScene('market.execInSandbox')).toBe('sandbox');
  });

  it('maps Cloud MCP paths to the mcp scene', () => {
    expect(pathToMarketAuthScene('market.callCloudMcpEndpoint')).toBe('mcp');
    expect(pathToMarketAuthScene('market.installCloudMcp')).toBe('mcp');
  });

  it('falls back to the default scene for unknown paths', () => {
    expect(pathToMarketAuthScene('market.followUser')).toBe('default');
    expect(pathToMarketAuthScene('market.getUserProfile')).toBe('default');
    expect(pathToMarketAuthScene('market.publishAgent')).toBe('default');
    expect(pathToMarketAuthScene('market.submitVersion')).toBe('default');
  });
});
