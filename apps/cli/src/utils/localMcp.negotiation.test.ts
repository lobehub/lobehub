import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startNegotiationServers } from '../../../../src/libs/mcp/__tests__/fixtures/negotiationServers';
import { listLocalMcpTools } from './localMcp';

describe('listLocalMcpTools against SDK v2 servers', () => {
  let servers: Awaited<ReturnType<typeof startNegotiationServers>>;

  beforeEach(async () => {
    servers = await startNegotiationServers();
  });

  afterEach(async () => {
    await servers.close();
    vi.restoreAllMocks();
  });

  it('lists a modern server that omits the caching hints, with a warning', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});

    const tools = await listLocalMcpTools({
      type: 'http',
      url: `${servers.url}/modern-no-cache-hints`,
    });

    expect(tools.map((tool) => tool.toolName)).toEqual(['echo', 'needs_input']);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('ttlMs, cacheScope'));
  });

  it('quotes the raw tools/list result when the listing is still invalid', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      listLocalMcpTools({ type: 'http', url: `${servers.url}/modern-broken-tools` }),
    ).rejects.toThrow(
      /Invalid result for tools\/list[\s\S]*Server response \(truncated\): \{.*"name":"echo"/,
    );
  });
});
