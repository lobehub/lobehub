import { describe, expect, it } from 'vitest';

import { isDeviceOnlyMcpEndpoint } from './mcpEndpoint';

describe('isDeviceOnlyMcpEndpoint', () => {
  it('treats stdio as device-only', () => {
    expect(isDeviceOnlyMcpEndpoint({ type: 'stdio' })).toBe(true);
  });

  it('treats a localhost or private-network HTTP endpoint as device-only', () => {
    expect(isDeviceOnlyMcpEndpoint({ type: 'http', url: 'http://localhost:3000/mcp' })).toBe(true);
    expect(isDeviceOnlyMcpEndpoint({ type: 'http', url: 'http://192.168.1.8/mcp' })).toBe(true);
    expect(isDeviceOnlyMcpEndpoint({ type: null, url: 'http://127.0.0.1:8080' })).toBe(true);
  });

  it('allows a public HTTP endpoint and the cloud transport', () => {
    expect(isDeviceOnlyMcpEndpoint({ type: 'http', url: 'https://mcp.example.com' })).toBe(false);
    expect(isDeviceOnlyMcpEndpoint({ type: 'cloud', url: 'http://localhost:3000' })).toBe(false);
    expect(isDeviceOnlyMcpEndpoint({})).toBe(false);
  });
});
